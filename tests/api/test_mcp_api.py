"""API tests for /api/mcp/* (Model Context Protocol integration).

Config CRUD is tested regardless of whether the `mcp` SDK is installed
(MCP_AVAILABLE). Tests that need an actual connection are skipped when the
SDK isn't present, matching how the app itself degrades gracefully.
"""

import pytest

import vllm_playground.app as app_module

requires_mcp = pytest.mark.skipif(not app_module.MCP_AVAILABLE, reason="mcp SDK not installed")


@pytest.fixture()
def isolated_mcp_manager(tmp_path, monkeypatch):
    """Give each test a fresh MCPManager backed by an isolated config file,
    instead of sharing the process-wide singleton across tests."""
    if not app_module.MCP_AVAILABLE:
        yield None
        return

    import vllm_playground.mcp_client.manager as manager_module
    from vllm_playground.mcp_client.config import MCPConfigStore
    from vllm_playground.mcp_client.manager import MCPManager

    fresh = MCPManager(config_store=MCPConfigStore(config_path=tmp_path / "mcp_servers.json"))
    monkeypatch.setattr(manager_module, "_mcp_manager", fresh)
    yield fresh


def test_mcp_status_when_unavailable(client, monkeypatch):
    monkeypatch.setattr(app_module, "MCP_AVAILABLE", False)
    resp = client.get("/api/mcp/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is False
    assert body["servers"] == []


@requires_mcp
def test_mcp_status_when_available(client, isolated_mcp_manager):
    resp = client.get("/api/mcp/status")
    assert resp.status_code == 200
    body = resp.json()
    assert body["available"] is True
    assert body["servers"] == []


def test_mcp_presets_lists_builtin_servers(client):
    resp = client.get("/api/mcp/presets")
    assert resp.status_code == 200


@requires_mcp
def test_mcp_configs_empty_by_default(client, isolated_mcp_manager):
    resp = client.get("/api/mcp/configs")
    assert resp.status_code == 200
    assert resp.json() == {"configs": []}


@requires_mcp
def test_mcp_save_and_list_config(client, isolated_mcp_manager):
    payload = {
        "name": "test-fs",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        "enabled": True,
        "auto_connect": False,
    }
    save_resp = client.post("/api/mcp/configs", json=payload)
    assert save_resp.status_code == 200

    list_resp = client.get("/api/mcp/configs")
    assert list_resp.status_code == 200
    configs = list_resp.json()["configs"]
    assert len(configs) == 1
    assert configs[0]["name"] == "test-fs"
    assert configs[0]["connected"] is False
    assert configs[0]["tools_count"] == 0


@requires_mcp
def test_mcp_delete_config(client, isolated_mcp_manager):
    client.post("/api/mcp/configs", json={"name": "to-delete", "transport": "stdio", "command": "uvx"})

    del_resp = client.delete("/api/mcp/configs/to-delete")
    assert del_resp.status_code == 200

    assert client.get("/api/mcp/configs").json()["configs"] == []


def test_mcp_configs_post_without_mcp_returns_400(client, monkeypatch):
    monkeypatch.setattr(app_module, "MCP_AVAILABLE", False)
    resp = client.post("/api/mcp/configs", json={"name": "x", "transport": "stdio", "command": "npx"})
    assert resp.status_code == 400


@requires_mcp
def test_mcp_tools_empty_when_nothing_connected(client, isolated_mcp_manager):
    resp = client.get("/api/mcp/tools")
    assert resp.status_code == 200
    assert resp.json() == {"tools": [], "count": 0}


@requires_mcp
def test_mcp_connect_unknown_server_fails(client, isolated_mcp_manager):
    resp = client.post("/api/mcp/connect/does-not-exist")
    assert resp.status_code == 400
