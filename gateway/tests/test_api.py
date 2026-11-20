"""HTTP layer. Needs fastapi + httpx (see requirements-dev.txt); skipped where they are not installed."""

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402


def client(**kw):
    return TestClient(create_app(Settings(mock_mode=True, db_path=":memory:", **kw)))


def test_health_and_models():
    with client() as c:
        assert c.get("/healthz").json()["status"] == "ok"
        body = c.get("/v1/models").json()
        assert body["source"] == "mock" and len(body["models"]) == 4


def test_chat_returns_route_reason_and_is_logged():
    with client() as c:
        r = c.post("/v1/chat", json={"prompt": "hello"})
        assert r.status_code == 200 and r.json()["route_reason"]
        assert c.get("/v1/logs").json()[0]["request_id"] == r.json()["request_id"]
        assert c.get("/v1/metrics").json()["requests"] == 1


def test_agent_endpoint_runs_tools():
    with client() as c:
        r = c.post("/v1/agent/run", json={"question": "Calculate 99 * 99"})
        assert r.status_code == 200 and "9801" in r.json()["answer"] and r.json()["tools_used"] == ["safe_calculator"]


def test_api_key_is_enforced_when_configured():
    with client(gateway_api_key="secret") as c:
        assert c.post("/v1/chat", json={"prompt": "hi"}).status_code == 401
        assert c.post("/v1/chat", json={"prompt": "hi"}, headers={"X-API-Key": "wrong"}).status_code == 401
        assert c.post("/v1/chat", json={"prompt": "hi"}, headers={"X-API-Key": "secret"}).status_code == 200


def test_rate_limit_returns_429_with_retry_after():
    with client(rate_limit_rpm=2) as c:
        assert [c.post("/v1/chat", json={"prompt": f"p{i}"}).status_code for i in range(3)] == [200, 200, 429]


def test_chaos_header_exercises_failover_and_is_validated():
    with client() as c:
        r = c.post("/v1/chat", json={"prompt": "hello"}, headers={"X-Chaos-Simulate": "rate_limit"})
        assert r.status_code == 200 and r.json()["attempts"][0]["outcome"] == "rate_limit"
        assert c.post("/v1/chat", json={"prompt": "hello"}, headers={"X-Chaos-Simulate": "nope"}).status_code == 422


def test_validation_errors_are_422():
    with client() as c:
        assert c.post("/v1/chat", json={"prompt": ""}).status_code == 422
        assert c.post("/v1/chat", json={"prompt": "hi", "policy": "bogus"}).status_code == 422


def test_budget_breaker_returns_503():
    with client(daily_budget_usd=1e-9) as c:
        assert c.post("/v1/chat", json={"prompt": "spend a little"}).status_code == 200
        assert c.post("/v1/chat", json={"prompt": "now refused"}).status_code == 503


def test_rag_ingest_then_agent_cites_the_new_document():
    with client() as c:
        c.post("/v1/rag/ingest", json={"doc_id": "handbook", "text": "The office wifi password rotates every Monday morning."})
        r = c.post("/v1/agent/run", json={"question": "When does the office wifi password rotate?"}).json()
        assert "[handbook:c1]" in r["answer"]


def test_limits_endpoint_documents_boundaries():
    with client() as c:
        assert {x["area"] for x in c.get("/v1/system/limits").json()["limitations"]} >= {"SQLite", "Free-tier quotas"}
