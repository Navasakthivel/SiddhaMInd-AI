"""DSN normalisation tests. No database required.

These cover the two Supabase-specific traps: asyncpg rejects libpq's ``sslmode``
query parameter, and the transaction pooler breaks asyncpg's statement cache.
"""

import pytest

# See the note in test_health.py - a missing driver must skip this module, not
# abort collection for the suites that need no dependencies at all.
pytest.importorskip("asyncpg", reason="asyncpg not installed - pip install -r requirements.txt")
pytest.importorskip("pgvector", reason="pgvector not installed")

from app.clients.database import _normalise_dsn  # noqa: E402


def test_strips_sslmode_and_requires_tls():
    dsn, kwargs = _normalise_dsn(
        "postgresql://postgres:pw@db.ref.supabase.co:5432/postgres?sslmode=require"
    )
    assert "sslmode" not in dsn
    assert kwargs["ssl"] == "require"


def test_defaults_to_tls_when_sslmode_absent():
    _, kwargs = _normalise_dsn("postgresql://postgres:pw@db.ref.supabase.co:5432/postgres")
    # asyncpg's own default is 'prefer', which would silently accept plaintext.
    assert kwargs["ssl"] == "require"


def test_honours_sslmode_disable():
    _, kwargs = _normalise_dsn("postgresql://u:p@localhost:5432/postgres?sslmode=disable")
    assert kwargs["ssl"] is False


def test_rewrites_sqlalchemy_style_prefix():
    dsn, _ = _normalise_dsn("postgresql+asyncpg://u:p@host:5432/postgres")
    assert dsn.startswith("postgresql://")


def test_rewrites_postgres_scheme():
    dsn, _ = _normalise_dsn("postgres://u:p@host:5432/postgres")
    assert dsn.startswith("postgresql://")


def test_disables_statement_cache_on_the_transaction_pooler():
    """PgBouncer transaction mode gives each statement a different backend."""
    _, kwargs = _normalise_dsn(
        "postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres"
    )
    assert kwargs["statement_cache_size"] == 0


def test_keeps_statement_cache_on_a_session_connection():
    _, kwargs = _normalise_dsn(
        "postgresql://postgres.ref:pw@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres"
    )
    assert "statement_cache_size" not in kwargs


def test_preserves_other_query_parameters():
    dsn, _ = _normalise_dsn(
        "postgresql://u:p@host:5432/postgres?sslmode=require&application_name=siddhamind"
    )
    assert "application_name=siddhamind" in dsn


# ---------------------------------------------------------------------------
# bulk chunk writes
# ---------------------------------------------------------------------------
#
# Ingestion writes every chunk of a book in one transaction, over a link to
# Supabase whose round-trip time is measured in hundreds of milliseconds. A
# write costing one round trip PER ROW is therefore O(rows x latency): 159
# chunks of the real corpus book took 112.9s against a 60s command timeout and
# failed, while the same rows in a single multi-row statement took 2.5s.
#
# So these tests pin statement COUNT, not wall-clock. Speed here is a property
# of how many times we cross the network, and that is what can regress.

import app.clients.database as db  # noqa: E402


class _RecordingConn:
    """Captures every statement issued, so tests can count network crossings."""

    def __init__(self):
        self.statements: list[tuple[str, tuple]] = []
        self.executemany_calls = 0

    async def execute(self, sql, *args):
        self.statements.append((sql, args))

    async def executemany(self, sql, rows):
        self.executemany_calls += 1
        for row in rows:
            self.statements.append((sql, tuple(row)))

    def transaction(self):
        conn = self

        class _Tx:
            async def __aenter__(self):
                conn.statements.append(("BEGIN", ()))

            async def __aexit__(self, *exc):
                conn.statements.append(("COMMIT", ()))
                return False

        return _Tx()


def _fake_pool(conn):
    class _Acquire:
        async def __aenter__(self):
            return conn

        async def __aexit__(self, *exc):
            return False

    class _Pool:
        def acquire(self):
            return _Acquire()

    return lambda: _Pool()


def _chunks(n, start=0):
    return [
        {
            "chunk_index": start + i,
            "content": f"chunk {start + i}",
            "embedding": [0.1] * 4,
            "book_name": "Marunthakaviyal",
            "page_no": i,
            "verse_no": None,
            "token_count": 12,
        }
        for i in range(n)
    ]


def _inserts(conn):
    return [s for s, _ in conn.statements if "INSERT" in s.upper()]


@pytest.mark.asyncio
async def test_writes_all_chunks_without_a_round_trip_per_row(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    written = await db.replace_document_chunks(2, _chunks(159))

    assert written == 159
    # The whole point: 159 rows must not cost 159 statements.
    assert len(_inserts(conn)) == 1
    assert conn.executemany_calls == 0


@pytest.mark.asyncio
async def test_every_column_of_every_row_survives_batching(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    await db.replace_document_chunks(2, _chunks(3))

    sql, args = next((s, a) for s, a in conn.statements if "INSERT" in s.upper())
    assert len(args) == 3 * 8, "8 columns per row, flattened in order"
    # Row 1 (0-indexed row 1) occupies params 9..16.
    assert args[8:16] == (2, "Marunthakaviyal", 1, None, 1, "chunk 1", 12, [0.1] * 4)
    # Placeholders must be numbered continuously across rows, not restart per row.
    assert "$9" in sql and f"${3 * 8}" in sql


@pytest.mark.asyncio
async def test_large_documents_split_into_batches_under_the_parameter_limit(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    await db.replace_document_chunks(2, _chunks(1201))

    inserts = _inserts(conn)
    assert len(inserts) > 1, "a document this size must be split"
    # Postgres refuses more than 65535 bind parameters in one statement.
    for _, args in ((s, a) for s, a in conn.statements if "INSERT" in s.upper()):
        assert len(args) <= 65535


@pytest.mark.asyncio
async def test_batches_cover_every_row_exactly_once(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    written = await db.replace_document_chunks(2, _chunks(1201))

    seen = []
    for _, args in ((s, a) for s, a in conn.statements if "INSERT" in s.upper()):
        # chunk_index is the 5th of 8 columns.
        seen.extend(args[i * 8 + 4] for i in range(len(args) // 8))
    assert seen == list(range(1201)), "no row dropped, duplicated or reordered"
    assert written == 1201


@pytest.mark.asyncio
async def test_delete_precedes_insert_inside_one_transaction(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    await db.replace_document_chunks(2, _chunks(2))

    kinds = [
        "BEGIN" if s == "BEGIN" else
        "COMMIT" if s == "COMMIT" else
        "DELETE" if "DELETE" in s.upper() else "INSERT"
        for s, _ in conn.statements
    ]
    assert kinds == ["BEGIN", "DELETE", "INSERT", "COMMIT"], (
        "a re-ingest must never leave old and new chunks mixed"
    )


@pytest.mark.asyncio
async def test_empty_chunk_list_still_clears_the_document(monkeypatch):
    conn = _RecordingConn()
    monkeypatch.setattr(db, "get_pool", _fake_pool(conn))

    written = await db.replace_document_chunks(2, [])

    assert written == 0
    assert _inserts(conn) == []
    assert any("DELETE" in s.upper() for s, _ in conn.statements)
