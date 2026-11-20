import io
import json

import pytest

from app.config import Settings
from app.idempotency import IdempotencyConflict, IdempotencyStore
from app.mcp_server import PROTOCOL, McpServer, serve
from app.prom import render
from tests.conftest import run

SUMMARY = {
    "requests": 10,
    "blocked": 2,
    "errors": 1,
    "cache_hit_rate": 0.25,
    "p50_ms": 150,
    "p95_ms": 450,
    "total_cost_usd": 0.0012,
    "by_model": {"mock-groq-fast-8b": 7, 'we"ird': 3},
}
MODELS = [
    {"id": "mock-groq-fast-8b", "provider": "groq", "tier": "fast", "health": "healthy"},
    {"id": "mock-gemini-pro", "provider": "gemini", "tier": "reasoning", "health": "cooldown"},
]


def test_prometheus_exposition_is_well_formed():
    text = render(SUMMARY, MODELS)
    assert text.endswith("\n")
    assert "# TYPE aegis_requests_total counter\naegis_requests_total 10\n" in text
    assert 'aegis_request_latency_ms{quantile="0.95"} 450' in text
    assert 'aegis_model_up{model="mock-groq-fast-8b",provider="groq",tier="fast"} 1' in text
    assert 'aegis_model_up{model="mock-gemini-pro",provider="gemini",tier="reasoning"} 0' in text
    assert 'model="we\\"ird"' in text  # label values are escaped
    for line in text.splitlines():
        assert line.startswith("#") or len(line.rsplit(" ", 1)) == 2


def test_idempotency_replay_conflict_and_expiry():
    now = [0.0]
    store = IdempotencyStore(ttl_s=10, max_entries=2, clock=lambda: now[0])
    body = {"prompt": "hi", "policy": "smart-router", "chaos": None}
    assert store.get("k1", body) is None
    store.put("k1", body, {"answer": "A"})
    assert store.get("k1", body) == {"answer": "A"}
    with pytest.raises(IdempotencyConflict):
        store.get("k1", {**body, "prompt": "different"})
    now[0] = 11
    assert store.get("k1", body) is None  # expired
    store.put("a", body, {})
    store.put("b", body, {})
    store.put("c", body, {})  # evicts the oldest
    assert store.get("a", body) is None and store.get("c", body) == {}


def _rpc(server, method, params=None, mid=1):
    return run(server.handle({"jsonrpc": "2.0", "id": mid, "method": method, **({"params": params} if params else {})}))


def test_mcp_handshake_and_tool_list():
    s = McpServer(Settings(mock_mode=True))
    init = _rpc(s, "initialize")
    assert init["result"]["protocolVersion"] == PROTOCOL and init["result"]["serverInfo"]["name"] == "aegis-gateway"
    assert run(s.handle({"jsonrpc": "2.0", "method": "notifications/initialized"})) is None
    names = {t["name"] for t in _rpc(s, "tools/list")["result"]["tools"]}
    assert names == {"calculator", "search_knowledge_base", "analyze_prompt", "gateway_chat"}
    assert _rpc(s, "nope")["error"]["code"] == -32601


def test_mcp_tools_work_and_errors_are_reported_not_raised():
    s = McpServer(Settings(mock_mode=True))
    call = lambda name, **a: _rpc(s, "tools/call", {"name": name, "arguments": a})["result"]  # noqa: E731
    assert call("calculator", expression="(12.5 * 8 + sqrt(144)) ^ 2 / 4")["content"][0]["text"] == "3136"
    bad = call("calculator", expression="__import__('os').system('id')")
    assert bad["isError"] is True
    kb = call("search_knowledge_base", query="What is the default TTL of the response cache?")["content"][0]["text"]
    assert "300 seconds" in kb and "[gateway-config:" in kb
    assert (
        "Insufficient grounded context"
        in call("search_knowledge_base", query="capital of France")["content"][0]["text"]
    )
    info = json.loads(call("analyze_prompt", prompt="Default rate limit? Max agent steps?")["content"][0]["text"])
    assert info["tier"] == "fast" and info.get("cnn_p_strong", 1) > 0.5
    chat = json.loads(call("gateway_chat", prompt="Say hello.")["content"][0]["text"])
    assert chat["status"] == "ok" and chat["model"].startswith("mock-")
    assert _rpc(s, "tools/call", {"name": "missing"})["error"]["code"] == -32602


def test_mcp_stdio_loop_round_trip():
    lines = [
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize"}),
        json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
        "not json",
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
    ]
    out = io.StringIO()
    run(serve(McpServer(Settings(mock_mode=True)), io.StringIO("\n".join(lines) + "\n"), out))
    replies = [json.loads(x) for x in out.getvalue().splitlines()]
    assert [r.get("id") for r in replies] == [1, None, 2]
    assert replies[1]["error"]["code"] == -32700
