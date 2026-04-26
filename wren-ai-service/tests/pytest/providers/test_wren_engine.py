import pytest
from aiohttp import ServerDisconnectedError

from src.providers.engine.wren import WrenIbis, WrenUI


class FakeResponse:
    def __init__(self, payload):
        self._payload = payload
        self.status = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def json(self):
        return self._payload

    async def text(self):
        return str(self._payload)


class FakeSession:
    def __init__(self, payload):
        self._payload = payload
        self.calls = []

    def post(self, url, headers, json, timeout):
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "timeout": timeout}
        )
        return FakeResponse(self._payload)


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_normalizes_runtime_scope_before_rest_request():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-1",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id=" deploy-1 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-1"}
    assert len(session.calls) == 1
    assert session.calls[0]["url"] == "http://wren-ui/api/v1/internal/sql/preview"
    assert session.calls[0]["headers"] == {
        "x-wren-ai-service-internal": "1",
    }
    assert session.calls[0]["json"] == {
        "sql": "SELECT 1",
        "runtimeScopeId": "deploy-1",
        "limit": 500,
    }


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_accepts_explicit_project_bridge_id_kwarg():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-2",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        bridge_scope_id=" legacy-project-2 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-2"}
    assert session.calls[0]["json"]["runtimeScopeId"] == "legacy-project-2"


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_prefers_runtime_scope_over_legacy_project_bridge():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-3",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id=" deploy-3 ",
        bridge_scope_id=" legacy-project-3 ",
        dry_run=False,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-3"}
    assert session.calls[0]["json"]["runtimeScopeId"] == "deploy-3"


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_passes_sql_mode_to_internal_preview():
    session = FakeSession(
        {
            "data": {"data": [{"id": 1}]},
            "correlationId": "corr-sql-mode",
        }
    )
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id="deploy-4",
        dry_run=True,
        sql_mode="dialect",
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-sql-mode"}
    assert session.calls[0]["json"] == {
        "sql": "SELECT 1",
        "runtimeScopeId": "deploy-4",
        "dryRun": True,
        "limit": 1,
        "sqlMode": "dialect",
    }


class FlakySession:
    def __init__(self):
        self.calls = []
        self._attempt = 0

    def post(self, url, headers, json, timeout):
        self.calls.append(
            {"url": url, "headers": headers, "json": json, "timeout": timeout}
        )
        self._attempt += 1
        if self._attempt == 1:
            raise ServerDisconnectedError("disconnected")
        return FakeResponse(
            {
                "data": {"data": [{"id": 1}]},
                "correlationId": "corr-retry",
            }
        )


@pytest.mark.asyncio
async def test_wren_ui_execute_sql_retries_transient_internal_preview_disconnect():
    session = FlakySession()
    engine = WrenUI(endpoint="http://wren-ui")

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        runtime_scope_id="deploy-5",
        dry_run=True,
    )

    assert success is True
    assert result == {"data": [{"id": 1}]}
    assert metadata == {"correlation_id": "corr-retry"}
    assert len(session.calls) == 2


def test_wren_ui_prefers_runtime_endpoint_env_over_config(monkeypatch):
    monkeypatch.setenv("WREN_UI_ENDPOINT", "http://env-wren-ui")

    engine = WrenUI(endpoint="http://config-wren-ui")

    assert engine._endpoint == "http://env-wren-ui"


class FlakyIbisSession:
    def __init__(self):
        self.calls = []
        self._attempt = 0

    def post(self, url, json, timeout):
        self.calls.append({"url": url, "json": json, "timeout": timeout})
        self._attempt += 1
        if self._attempt == 1:
            raise ServerDisconnectedError("disconnected")
        return FakeResponse("dry-run-ok")


@pytest.mark.asyncio
async def test_wren_ibis_execute_sql_retries_transient_disconnects():
    session = FlakyIbisSession()
    engine = WrenIbis(
        endpoint="http://wren-ibis",
        source="tidb",
        manifest="{}",
        connection_info="",
    )

    success, result, metadata = await engine.execute_sql(
        "SELECT 1 LIMIT 10",
        session=session,
        dry_run=True,
    )

    assert success is True
    assert result == "dry-run-ok"
    assert metadata == {"correlation_id": ""}
    assert len(session.calls) == 2
