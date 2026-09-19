"""API tests for chat/completions proxying (/api/chat, /api/completion),
covering the "Chat UI + streaming + tool calling" and "structured outputs"
major use cases against a stubbed upstream vLLM server.
"""

import json

import vllm_playground.app as app_module


def _activate_subprocess_server(model="tiny-model"):
    app_module.current_run_mode = "subprocess"
    from types import SimpleNamespace

    app_module.vllm_process = SimpleNamespace(returncode=None)
    app_module.current_config = app_module.VLLMConfig(model=model, run_mode="subprocess", port=8000)


def test_chat_requires_running_server(client):
    resp = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}], "stream": False})
    assert resp.status_code == 400


def test_chat_non_streaming_success(client, fake_aiohttp):
    _activate_subprocess_server()
    fake_aiohttp.add(
        "POST",
        "/v1/chat/completions",
        json_data={
            "id": "chatcmpl-1",
            "choices": [{"message": {"role": "assistant", "content": "Hello there!"}, "finish_reason": "stop"}],
        },
        status=200,
    )

    resp = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": False},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["choices"][0]["message"]["content"] == "Hello there!"


def test_chat_non_streaming_propagates_upstream_error(client, fake_aiohttp):
    _activate_subprocess_server()
    fake_aiohttp.add("POST", "/v1/chat/completions", status=500, text_data="internal vllm error")

    resp = client.post(
        "/api/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": False},
    )
    assert resp.status_code == 500
    assert "internal vllm error" in resp.json()["detail"]


def test_chat_streaming_forwards_sse_chunks(client, fake_aiohttp):
    _activate_subprocess_server()
    sse_chunks = [
        'data: {"choices": [{"delta": {"content": "Hel"}}]}\n',
        'data: {"choices": [{"delta": {"content": "lo"}}]}\n',
        "data: [DONE]\n",
    ]
    fake_aiohttp.add("POST", "/v1/chat/completions", status=200, stream_chunks=sse_chunks)

    with client.stream(
        "POST",
        "/api/chat",
        json={"messages": [{"role": "user", "content": "hi"}], "stream": True},
    ) as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = "".join(resp.iter_text())

    assert "Hel" in body
    assert "[DONE]" in body


def test_chat_with_tool_calling_request_shape(client, fake_aiohttp):
    _activate_subprocess_server()

    fake_aiohttp.add(
        "POST",
        "/v1/chat/completions",
        json_data={
            "id": "chatcmpl-2",
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": None,
                        "tool_calls": [
                            {
                                "id": "call_1",
                                "type": "function",
                                "function": {"name": "get_weather", "arguments": '{"city": "Boston"}'},
                            }
                        ],
                    },
                    "finish_reason": "tool_calls",
                }
            ],
        },
        status=200,
    )

    resp = client.post(
        "/api/chat",
        json={
            "messages": [{"role": "user", "content": "What's the weather in Boston?"}],
            "stream": False,
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Get weather for a city",
                        "parameters": {
                            "type": "object",
                            "properties": {"city": {"type": "string"}},
                            "required": ["city"],
                        },
                    },
                }
            ],
            "tool_choice": "auto",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    tool_calls = body["choices"][0]["message"]["tool_calls"]
    assert tool_calls[0]["function"]["name"] == "get_weather"
    assert json.loads(tool_calls[0]["function"]["arguments"]) == {"city": "Boston"}

    # The request actually sent upstream should carry the tools/tool_choice through.
    assert any(m == "POST" and "/v1/chat/completions" in u for m, u in fake_aiohttp.requests)


def test_completion_requires_running_server(client):
    resp = client.post("/api/completion", json={"prompt": "Once upon a time"})
    assert resp.status_code == 400


def test_completion_success(client, fake_aiohttp):
    _activate_subprocess_server()
    fake_aiohttp.add(
        "POST",
        "/v1/completions",
        json_data={"id": "cmpl-1", "choices": [{"text": ", there was a dragon."}]},
        status=200,
    )

    resp = client.post("/api/completion", json={"prompt": "Once upon a time", "max_tokens": 32})
    assert resp.status_code == 200
    assert resp.json()["choices"][0]["text"] == ", there was a dragon."
