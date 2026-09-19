"""Unit tests for vllm_playground.image_catalog.

Covers the pure/synchronous helpers directly, and the async Docker Hub
fetch path with the network mocked via aioresponses.
"""

import pytest

from vllm_playground import image_catalog

# ---------------------------------------------------------------------------
# Pure helpers (no network, no async)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "tag,expected",
    [
        ("v0.29.0", (0, 29, 0, 10_000)),
        ("v0.29.0rc1", (0, 29, 0, 1)),
        ("0.29.0", (0, 29, 0, 10_000)),
        ("latest", None),
        ("v0.29.0-cu129-ubuntu2404", None),
        ("nightly-abc123", None),
    ],
)
def test_parse_version(tag, expected):
    assert image_catalog._parse_version(tag) == expected


def test_filter_and_sort_tags_orders_newest_first_and_excludes_noise():
    raw = ["v0.27.0", "latest", "v0.29.0", "nightly-x", "v0.29.0rc1", "v0.28.0-cu129-ubuntu2404"]
    result = image_catalog._filter_and_sort_tags(raw)
    assert result == ["v0.29.0", "v0.29.0rc1", "v0.27.0"]


def test_filter_and_sort_tags_respects_limit():
    raw = [f"v0.{i}.0" for i in range(20)]
    result = image_catalog._filter_and_sort_tags(raw, limit=3)
    assert len(result) == 3
    assert result == ["v0.19.0", "v0.18.0", "v0.17.0"]


def test_merge_default_adds_missing_default_tag():
    tags = ["v0.28.0", "v0.27.0"]
    merged = image_catalog._merge_default(tags, "v0.29.0")
    assert merged[0] == "v0.29.0"
    assert "v0.28.0" in merged and "v0.27.0" in merged


def test_merge_default_noop_when_already_present():
    tags = ["v0.29.0", "v0.28.0"]
    merged = image_catalog._merge_default(tags, "v0.29.0")
    assert merged == tags


@pytest.mark.parametrize(
    "tag,valid",
    [
        ("v0.29.0", True),
        ("docker.io/vllm/vllm-openai:v0.30.0", True),
        ("nightly", True),
        ("v0.29.0-cu129", True),
        ("", False),
        ("a" * 300, False),
        ("v0.29.0; rm -rf /", False),
        ("v0.29.0 && echo pwned", False),
        ("$(whoami)", False),
        ("v0.29.0\nmalicious", False),
    ],
)
def test_is_valid_custom_tag(tag, valid):
    assert image_catalog.is_valid_custom_tag(tag) is valid


# ---------------------------------------------------------------------------
# Async Docker Hub fetch (network mocked)
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_cache():
    """Each test gets a clean in-memory cache/lock state."""
    image_catalog._cache.clear()
    image_catalog._locks.clear()
    yield
    image_catalog._cache.clear()
    image_catalog._locks.clear()


@pytest.mark.asyncio
async def test_get_versions_uses_docker_hub_when_reachable(fake_aiohttp):
    key = "image_override_gpu_nvidia"
    repo = image_catalog.IMAGE_REPOS[key]["repo"]
    url = image_catalog.DOCKER_HUB_TAGS_URL.format(repo=repo)
    fake_aiohttp.add(
        "GET",
        url,
        json_data={
            "results": [
                {"name": "v0.30.0"},
                {"name": "v0.29.0"},
                {"name": "latest"},
                {"name": "v0.29.0-cu129-ubuntu2404"},
            ]
        },
    )

    result = await image_catalog.get_versions(key, force_refresh=True)

    assert result["source"] == "docker_hub"
    assert result["options"][0] == "v0.30.0"
    assert "latest" not in result["options"]


@pytest.mark.asyncio
async def test_get_versions_falls_back_when_docker_hub_unreachable(fake_aiohttp):
    key = "image_override_cpu"
    repo = image_catalog.IMAGE_REPOS[key]["repo"]
    url = image_catalog.DOCKER_HUB_TAGS_URL.format(repo=repo)
    fake_aiohttp.add("GET", url, status=500, json_data={})

    result = await image_catalog.get_versions(key, force_refresh=True)

    assert result["source"] == "fallback"
    assert result["options"] == image_catalog.IMAGE_REPOS[key]["fallback_tags"]


@pytest.mark.asyncio
async def test_get_versions_uses_cache_within_ttl(fake_aiohttp):
    key = "image_override_gpu_amd"
    repo = image_catalog.IMAGE_REPOS[key]["repo"]
    url = image_catalog.DOCKER_HUB_TAGS_URL.format(repo=repo)
    fake_aiohttp.add("GET", url, json_data={"results": [{"name": "v0.29.0"}]})

    first = await image_catalog.get_versions(key, force_refresh=True)
    assert first["source"] == "docker_hub"

    # Route is only registered once above -- if the cache isn't used, the
    # FakeAiohttpSession would raise AssertionError for the unmatched 2nd
    # call; asserting "cache" proves the cache path was taken instead.
    second = await image_catalog.get_versions(key, force_refresh=False)
    assert second["source"] == "cache"


@pytest.mark.asyncio
async def test_get_versions_unknown_key_raises():
    with pytest.raises(KeyError):
        await image_catalog.get_versions("not_a_real_key")


@pytest.mark.asyncio
async def test_get_full_catalog_covers_all_keys(fake_aiohttp):
    for entry in image_catalog.IMAGE_REPOS.values():
        url = image_catalog.DOCKER_HUB_TAGS_URL.format(repo=entry["repo"])
        fake_aiohttp.add("GET", url, json_data={"results": [{"name": entry["default_tag"]}]})

    catalog = await image_catalog.get_full_catalog(force_refresh=True)

    assert set(catalog.keys()) == set(image_catalog.IMAGE_REPOS.keys())
    for key, entry in catalog.items():
        assert entry["default_tag"] in entry["options"]
