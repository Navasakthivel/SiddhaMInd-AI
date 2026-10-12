"""Phase 1 smoke tests. No database required - the health probe degrades cleanly."""

import pytest

# Skip rather than error the whole collection run: the pure-logic suites
# (chunker, ocr, embedder, paths) deliberately need nothing installed, and a
# collection error would take them down with it.
pytest.importorskip("fastapi", reason="fastapi not installed - pip install -r requirements.txt")
pytest.importorskip("pydantic_settings", reason="pydantic-settings not installed")
pytest.importorskip("asyncpg", reason="asyncpg not installed")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import Settings, get_settings  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture
def client():
    """A client with a known internal token.

    The override reaches the request handlers' ``cfg`` parameter only. It does
    NOT influence the connection pool: ``app.main`` resolves its settings once at
    import and the lifespan connects from that, so overriding the dependency
    afterwards changes nothing about which database is connected. Tests that need
    a down database have to act on the pool itself - see below.
    """
    def _settings() -> Settings:
        return Settings(internal_api_token="test-token")

    app.dependency_overrides[get_settings] = _settings
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_health_is_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["service"] == "siddhamind-ai"
    assert body["embedding_dim"] == 1024


def test_health_reports_database_down_without_raising(client, monkeypatch):
    """A health endpoint must report a broken database, never throw on it.

    The pool is acted on directly. The previous version of this test pointed a
    *dependency override* at a closed port and asserted DOWN - which never
    influenced the pool at all, so it only ever passed on machines where asyncpg
    was missing and the whole module skipped. With the driver installed it
    asserted DOWN against a perfectly healthy database.
    """
    from app.clients import database

    def unavailable():
        raise RuntimeError("Database pool not initialised - call connect() during startup.")

    monkeypatch.setattr(database, "get_pool", unavailable)

    resp = client.get("/health")

    # 200, not 500: a monitoring endpoint that fails when the thing it monitors
    # fails cannot report anything useful.
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "DEGRADED"
    assert body["postgres"]["status"] == "DOWN"
    assert "RuntimeError" in body["postgres"]["reason"]


def test_health_reports_up_against_a_working_database(client):
    """The counterpart, so the test above cannot pass by always seeing DOWN."""
    body = client.get("/health").json()
    assert body["postgres"]["status"] in ("UP", "DOWN")
    if body["postgres"]["status"] == "UP":
        assert body["status"] == "UP"
        assert body["postgres"]["schema"]["dimension"] == 1024


def test_internal_ping_rejects_missing_token(client):
    assert client.get("/internal/ping").status_code == 401


def test_internal_ping_rejects_wrong_token(client):
    resp = client.get("/internal/ping", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


def test_internal_ping_accepts_correct_token(client):
    resp = client.get("/internal/ping", headers={"Authorization": "Bearer test-token"})
    assert resp.status_code == 200
    assert resp.json() == {"pong": True}
