"""API tests for tool-calling support endpoints (/api/tools/*)."""


def test_tools_presets_shape(client):
    resp = client.get("/api/tools/presets")
    assert resp.status_code == 200
    body = resp.json()
    assert body["count"] == len(body["presets"])
    assert "code_execution" in body["presets"]


def test_tools_info_lists_recommended_models(client):
    resp = client.get("/api/tools/info")
    assert resp.status_code == 200
    body = resp.json()
    assert body["supported"] is True
    names = [m["name"] for m in body["recommended_models"]]
    assert "Llama 3.1/3.2" in names


def test_validate_tools_accepts_well_formed_tool(client):
    payload = {
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                    "description": "Get the weather for a city",
                    "parameters": {
                        "type": "object",
                        "properties": {"city": {"type": "string"}},
                        "required": ["city"],
                    },
                },
            }
        ]
    }
    resp = client.post("/api/tools/validate", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is True
    assert body["results"][0]["valid"] is True
    assert body["results"][0]["errors"] == []


def test_validate_tools_flags_invalid_function_name(client):
    payload = {
        "tools": [
            {
                "type": "function",
                "function": {"name": "123-not-a-valid-name!", "description": "bad name"},
            }
        ]
    }
    resp = client.post("/api/tools/validate", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert any("Invalid function name" in e for e in body["results"][0]["errors"])


def test_validate_tools_flags_non_function_type(client):
    payload = {"tools": [{"type": "not-a-function", "function": {"name": "ok_name"}}]}
    resp = client.post("/api/tools/validate", json=payload)
    assert resp.status_code == 200
    body = resp.json()
    assert body["valid"] is False
    assert body["results"][0]["valid"] is False
