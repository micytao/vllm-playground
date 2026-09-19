"""
Shared pytest configuration for the vLLM Playground test suite.

IMPORTANT: several modules compute persistent-storage paths as
``Path.home() / ".vllm-playground"`` either at *call time*
(``settings_store.SettingsStore``, ``backend_registry.InstanceRegistry``,
``mcp_client.config.MCPConfigStore``) or at *import time*
(``vllm_playground.app``'s module-level ``settings_store`` and
``metric_store`` singletons). To make sure the test suite never reads from
or writes to a real developer's ``~/.vllm-playground`` directory, we
redirect ``HOME`` to an isolated temporary directory *before* anything in
this file (or any test module) imports ``vllm_playground``.
"""

import os
import tempfile
from pathlib import Path

_TEST_HOME = tempfile.mkdtemp(prefix="vllm-playground-test-home-")
os.environ["HOME"] = _TEST_HOME
# USERPROFILE is the Windows equivalent of HOME; set for completeness even
# though this project primarily targets macOS/Linux.
os.environ["USERPROFILE"] = _TEST_HOME

import pytest  # noqa: E402


@pytest.fixture()
def isolated_home(tmp_path, monkeypatch):
    """Point ``Path.home()`` at a fresh per-test temp directory.

    Use this fixture in tests that construct their own store instances
    (``SettingsStore()``, ``InstanceRegistry()``, etc.) and want a clean,
    test-local ``~/.vllm-playground`` without needing to pass an explicit
    ``config_path``/``state_path`` override.
    """
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    return tmp_path


@pytest.fixture(autouse=True, scope="session")
def _test_home_dir():
    """Expose the session-wide fake HOME dir for diagnostics; ensures it exists."""
    Path(_TEST_HOME).mkdir(parents=True, exist_ok=True)
    yield _TEST_HOME


# ---------------------------------------------------------------------------
# Lightweight aiohttp mocking
# ---------------------------------------------------------------------------
#
# NOTE: we deliberately do NOT use the third-party `aioresponses` library
# here. At the time this suite was written, aioresponses 0.7.9 (latest on
# PyPI) is incompatible with aiohttp >= 3.12 (`ClientResponse.__init__()`
# gained a required `stream_writer` kwarg that aioresponses doesn't pass),
# which would make the whole suite flaky/broken depending on which aiohttp
# patch version CI happens to resolve. This tiny hand-rolled fake covers
# every aiohttp usage pattern in this codebase (`async with session.get(...)
# as resp`, `resp = await session.post(...)`, and streaming SSE reads via
# `resp.content.iter_any()`) without depending on aiohttp/aioresponses
# internals at all.


class FakeAiohttpContent:
    """Fakes ``aiohttp.StreamReader`` for SSE-style streaming reads."""

    def __init__(self, chunks=None):
        self._chunks = chunks or []

    async def iter_any(self):
        for chunk in self._chunks:
            yield chunk if isinstance(chunk, bytes) else str(chunk).encode("utf-8")


class FakeAiohttpResponse:
    """Fakes ``aiohttp.ClientResponse``."""

    def __init__(self, status=200, json_data=None, text_data=None, headers=None, stream_chunks=None):
        self.status = status
        self.headers = headers or {}
        self._json_data = json_data
        if text_data is not None:
            self._text_data = text_data
        elif json_data is not None:
            import json as _json

            self._text_data = _json.dumps(json_data)
        else:
            self._text_data = ""
        self.content = FakeAiohttpContent(stream_chunks)

    async def json(self):
        return self._json_data

    async def text(self):
        return self._text_data

    def release(self):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


class _FakeRequestContext:
    """Return value of ``session.get()``/``session.post()``.

    Supports both call styles used across the codebase:
    ``async with session.get(url) as resp:`` and ``resp = await session.post(url)``.
    """

    def __init__(self, resolver, method, url):
        self._resolver = resolver
        self._method = method
        self._url = url

    def _resolve(self):
        result = self._resolver(self._method, self._url)
        if isinstance(result, BaseException):
            raise result
        return result

    def __await__(self):
        async def _run():
            return self._resolve()

        return _run().__await__()

    async def __aenter__(self):
        return self._resolve()

    async def __aexit__(self, *exc_info):
        return False


class FakeAiohttpSession:
    """Fakes ``aiohttp.ClientSession`` with simple substring-matched routing.

    Usage::

        session = FakeAiohttpSession()
        session.add("GET", "/v1/models", json_data={"data": []})
        session.add("POST", "/v1/chat/completions", exception=ConnectionError("boom"))
    """

    def __init__(self):
        self._routes = []  # list of (method, matcher, response_or_exception)
        self.requests = []  # list of (method, url) actually requested, for assertions

    def add(self, method, url_contains, response=None, *, exception=None, status=200, json_data=None, **kwargs):
        if exception is not None:
            outcome = exception
        elif response is not None:
            outcome = response
        else:
            outcome = FakeAiohttpResponse(status=status, json_data=json_data, **kwargs)
        matcher = url_contains if callable(url_contains) else (lambda u, needle=url_contains: needle in str(u))
        self._routes.append((method.upper(), matcher, outcome))

    def _resolve(self, method, url):
        self.requests.append((method.upper(), str(url)))
        for m, matcher, outcome in self._routes:
            if m == method.upper() and matcher(url):
                return outcome
        raise AssertionError(f"FakeAiohttpSession: no route registered for {method} {url}")

    def get(self, url, **kwargs):
        return _FakeRequestContext(self._resolve, "GET", url)

    def post(self, url, **kwargs):
        return _FakeRequestContext(self._resolve, "POST", url)

    async def close(self):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False


@pytest.fixture()
def fake_aiohttp(monkeypatch):
    """Patch ``aiohttp.ClientSession`` so any code doing
    ``async with aiohttp.ClientSession(...) as session:`` transparently
    receives a ``FakeAiohttpSession`` that this fixture returns, ready for
    ``.add(method, url_substring, ...)`` route registration.
    """
    import aiohttp as _aiohttp

    session = FakeAiohttpSession()
    monkeypatch.setattr(_aiohttp, "ClientSession", lambda *a, **kw: session)
    return session
