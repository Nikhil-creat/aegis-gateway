"""Minimal Model Context Protocol server over stdio (newline-delimited JSON-RPC 2.0, protocol 2024-11-05).

Exposes the gateway's building blocks as MCP tools so any MCP client (Claude Desktop, IDE agents) can call them:
  calculator             safe AST calculator (no eval)
  search_knowledge_base  hybrid BM25 + trigram retrieval with a grounding threshold
  analyze_prompt         heuristic difficulty score and tier, plus the CNN's p(strong) when weights exist
  gateway_chat           send a prompt through the full gateway (mock provider unless API keys are set)

Run:  python -m app.mcp_server        Client config:  {"command": "python", "args": ["-m", "app.mcp_server"]}
Scope: tools only. No resources, prompts, sampling or HTTP transport.
"""

from __future__ import annotations

import asyncio
import json
import sys
from typing import Any

from app import __version__
from app.cache import MemoryCache
from app.config import Settings
from app.db import RequestLog
from app.gateway import POLICIES, Gateway, InvalidRequest
from app.kb import default_index
from app.learned_router import get_model
from app.models import MOCK_MODELS, Registry
from app.providers import build_pool
from app.router import analyze
from app.tools import CalcError, fmt_number, safe_calculator

PROTOCOL = "2024-11-05"

TOOLS: list[dict[str, Any]] = [
    {
        "name": "calculator",
        "description": "Evaluate an arithmetic expression safely (+ - * / ** % parentheses, sqrt, abs, round, min, max).",
        "inputSchema": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]},
    },
    {
        "name": "search_knowledge_base",
        "description": "Search the gateway's built-in knowledge base. Returns the best chunk with its citation, or says nothing grounded was found.",
        "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]},
    },
    {
        "name": "analyze_prompt",
        "description": "Explain how the router would classify a prompt: difficulty score, tier and signals.",
        "inputSchema": {"type": "object", "properties": {"prompt": {"type": "string"}}, "required": ["prompt"]},
    },
    {
        "name": "gateway_chat",
        "description": "Send a prompt through the gateway (security, routing, cache, provider failover). Uses a mock provider unless GROQ_API_KEY or GEMINI_API_KEY is set.",
        "inputSchema": {
            "type": "object",
            "properties": {"prompt": {"type": "string"}, "policy": {"type": "string", "enum": list(POLICIES)}},
            "required": ["prompt"],
        },
    },
]


class McpServer:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings.from_env()
        self.index = default_index()
        self._gateway: Gateway | None = None

    def _gw(self) -> Gateway:
        if self._gateway is None:
            cfg = self.settings
            self._gateway = Gateway(
                cfg,
                Registry(MOCK_MODELS),
                build_pool(cfg),
                RequestLog(":memory:"),
                MemoryCache(cfg.cache_max, cfg.cache_ttl_s),
            )
        return self._gateway

    async def call_tool(self, name: str, args: dict[str, Any]) -> str:
        if name == "calculator":
            return fmt_number(safe_calculator(str(args.get("expression", ""))))
        if name == "search_knowledge_base":
            grounded, hits = self.index.search(str(args.get("query", "")), 1)
            if not grounded or not hits:
                return "Insufficient grounded context: nothing in the knowledge base matched."
            c = hits[0].chunk
            return f"{c.text} [{c.doc}:{c.id}]"
        if name == "analyze_prompt":
            prompt = str(args.get("prompt", ""))
            a = analyze(prompt)
            out = {"difficulty": round(a.difficulty, 2), "tier": a.tier, "signals": list(a.signals)}
            cnn = get_model()
            if cnn is not None:
                out["cnn_p_strong"] = round(cnn.predict_proba(prompt), 3)
            return json.dumps(out)
        if name == "gateway_chat":
            res = await self._gw().chat(str(args.get("prompt", "")), str(args.get("policy", "smart-router")))
            return json.dumps({k: res[k] for k in ("status", "model", "tier", "answer", "cost_usd", "latency_ms")})
        raise KeyError(name)

    async def handle(self, msg: dict[str, Any]) -> dict[str, Any] | None:
        """Process one JSON-RPC message. Returns None for notifications."""
        method, mid = msg.get("method"), msg.get("id")
        if mid is None:  # notification (e.g. notifications/initialized)
            return None

        def ok(result: dict[str, Any]) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": mid, "result": result}

        def err(code: int, text: str) -> dict[str, Any]:
            return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": text}}

        if method == "initialize":
            return ok(
                {
                    "protocolVersion": PROTOCOL,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "aegis-gateway", "version": __version__},
                }
            )
        if method == "ping":
            return ok({})
        if method == "tools/list":
            return ok({"tools": TOOLS})
        if method == "tools/call":
            params = msg.get("params") or {}
            name, args = params.get("name"), params.get("arguments") or {}
            if name not in {t["name"] for t in TOOLS}:
                return err(-32602, f"unknown tool: {name}")
            try:
                text = await self.call_tool(name, args)
                return ok({"content": [{"type": "text", "text": text}], "isError": False})
            except (CalcError, InvalidRequest) as exc:
                return ok({"content": [{"type": "text", "text": f"Error: {exc}"}], "isError": True})
        return err(-32601, f"method not found: {method}")


async def serve(server: McpServer, reader: Any = sys.stdin, writer: Any = sys.stdout) -> None:
    loop = asyncio.get_running_loop()
    while True:
        line = await loop.run_in_executor(None, reader.readline)
        if not line:
            return
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply: dict[str, Any] | None = {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32700, "message": "parse error"},
            }
        else:
            reply = await server.handle(msg)
        if reply is not None:
            writer.write(json.dumps(reply, separators=(",", ":")) + "\n")
            writer.flush()


def main() -> None:
    asyncio.run(serve(McpServer()))


if __name__ == "__main__":
    main()
