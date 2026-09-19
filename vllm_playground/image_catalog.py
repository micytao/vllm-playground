"""
Container Image Version Catalog

Provides the list of selectable container image versions for the
Settings > Container Images tab. Versions are fetched live from Docker Hub's
public tags API (cached in-memory with a TTL), with a small built-in
fallback list used whenever Docker Hub is unreachable (offline / air-gapped
/ rate-limited environments such as many OpenShift clusters).

This module is intentionally standalone (no dependency on settings_store or
container_manager) so it can be unit tested in isolation. app.py is
responsible for merging the returned catalog with the user's persisted
overrides from settings_store.
"""

import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

logger = logging.getLogger(__name__)

# How long a successful Docker Hub fetch is cached before being refetched.
CACHE_TTL_SECONDS = 6 * 60 * 60  # 6 hours

# Docker Hub tags API. `page_size=100` + client-side filtering is used because
# repos are polluted with many more nightly/arch-variant tag pushes than
# actual releases, so recency ordering alone is not reliable (see
# IMAGE_REPOS fallback_tags comment for context captured during verification).
DOCKER_HUB_TAGS_URL = "https://hub.docker.com/v2/repositories/{repo}/tags"

# Only accept clean semver-style release tags (optionally with an rc suffix).
# This excludes noise like "v0.29.0-cu129-ubuntu2404", "latest-x86_64",
# "nightly-<sha>", etc.
_SEMVER_TAG_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:rc(\d+))?$")

# Settings key -> Docker Hub repo + built-in default + offline fallback list.
# Fallback lists are short, hand-verified snapshots (newest first) so the
# dropdown is never empty even with zero network access. They intentionally
# lag behind reality over time; the live Docker Hub fetch is always
# preferred when reachable.
IMAGE_REPOS: Dict[str, Dict[str, Any]] = {
    "image_override_gpu_nvidia": {
        "label": "vLLM (GPU - NVIDIA)",
        "repo": "vllm/vllm-openai",
        "default_tag": "v0.29.0",
        "fallback_tags": ["v0.29.0", "v0.28.0", "v0.27.1", "v0.27.0", "v0.26.0", "v0.25.1", "v0.24.0"],
        "description": (
            "Official vLLM inference server built for NVIDIA CUDA GPUs. Used when starting the "
            "vLLM Server in Container mode with the NVIDIA accelerator selected. Recommended for "
            "most single- or multi-GPU deployments on NVIDIA hardware."
        ),
    },
    "image_override_gpu_amd": {
        "label": "vLLM (GPU - AMD ROCm)",
        "repo": "vllm/vllm-openai-rocm",
        "default_tag": "v0.29.0",
        "fallback_tags": ["v0.29.0", "v0.28.0", "v0.27.1", "v0.27.0", "v0.26.0", "v0.25.1", "v0.24.0"],
        "description": (
            "Official vLLM inference server built for AMD ROCm GPUs (e.g. MI200/MI300 series). "
            "Used when starting the vLLM Server in Container mode with the AMD accelerator selected."
        ),
    },
    "image_override_cpu": {
        "label": "vLLM (CPU)",
        "repo": "vllm/vllm-openai-cpu",
        "default_tag": "v0.29.0",
        "fallback_tags": ["v0.29.0", "v0.28.0", "v0.27.1", "v0.27.0", "v0.26.0", "v0.25.1", "v0.24.0"],
        "description": (
            "Official vLLM inference server for CPU-only inference — no GPU required. Multi-arch "
            "image that works on both x86_64 Linux and ARM64 (e.g. Apple Silicon Macs). Used when "
            "CPU mode is enabled."
        ),
    },
    "image_override_omni_nvidia": {
        "label": "vLLM-Omni (NVIDIA)",
        "repo": "vllm/vllm-omni",
        "default_tag": "v0.28.0",
        "fallback_tags": ["v0.28.0", "v0.26.0", "v0.24.0", "v0.22.0", "v0.20.0"],
        "description": (
            "vLLM-Omni multimodal server (text-to-image/video/audio generation) built for NVIDIA "
            "CUDA GPUs. Used when starting vLLM-Omni in Container mode with the NVIDIA accelerator."
        ),
    },
    "image_override_omni_amd": {
        "label": "vLLM-Omni (AMD ROCm)",
        "repo": "vllm/vllm-omni-rocm",
        "default_tag": "v0.28.0",
        "fallback_tags": ["v0.28.0", "v0.26.0", "v0.24.0", "v0.22.0", "v0.20.0"],
        "description": (
            "vLLM-Omni multimodal server (text-to-image/video/audio generation) built for AMD "
            "ROCm GPUs. Used when starting vLLM-Omni in Container mode with the AMD accelerator."
        ),
    },
}

# In-memory cache: repo -> (fetched_at_epoch, tags_list)
_cache: Dict[str, Tuple[float, List[str]]] = {}
# Prevents concurrent duplicate fetches for the same repo (e.g. several
# browser tabs/requests hitting the catalog endpoint at once).
_locks: Dict[str, asyncio.Lock] = {}


def _parse_version(tag: str) -> Optional[Tuple[int, int, int, int]]:
    """
    Parse a semver-ish tag into a sortable tuple.

    Stable releases sort after release candidates of the same version, e.g.
    v0.29.0 > v0.29.0rc1. Returns None if the tag doesn't match the expected
    shape (caller should exclude it from the dropdown).
    """
    match = _SEMVER_TAG_RE.match(tag)
    if not match:
        return None
    major, minor, patch, rc = match.groups()
    # No rc suffix (stable release) sorts higher than any rc of the same
    # version, so use a large sentinel when rc is absent.
    rc_value = int(rc) if rc is not None else 10_000
    return (int(major), int(minor), int(patch), rc_value)


def _filter_and_sort_tags(raw_tags: List[str], limit: int = 12) -> List[str]:
    """Filter to clean semver tags and sort newest-first by parsed version."""
    parsed: List[Tuple[Tuple[int, int, int, int], str]] = []
    for tag in raw_tags:
        version = _parse_version(tag)
        if version is not None:
            parsed.append((version, tag))
    parsed.sort(key=lambda item: item[0], reverse=True)
    return [tag for _, tag in parsed[:limit]]


async def _fetch_tags_from_docker_hub(repo: str) -> List[str]:
    """
    Fetch and filter release tags for a Docker Hub repo.

    Raises on any network/parse failure; callers should catch and fall back
    to the static fallback_tags list.
    """
    url = DOCKER_HUB_TAGS_URL.format(repo=repo)
    params = {"page_size": "100", "ordering": "-last_updated"}
    timeout = aiohttp.ClientTimeout(total=10, connect=5)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.get(url, params=params) as response:
            if response.status != 200:
                raise RuntimeError(f"Docker Hub returned HTTP {response.status} for {repo}")
            data = await response.json()

    raw_tags = [result.get("name", "") for result in data.get("results", [])]
    return _filter_and_sort_tags(raw_tags)


async def get_versions(key: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Get the version catalog entry for a single settings key.

    Args:
        key: One of the IMAGE_REPOS keys (e.g. "image_override_gpu_nvidia")
        force_refresh: Bypass the cache and re-fetch from Docker Hub

    Returns:
        {
            "label": str,
            "description": str,
            "repo": str,
            "default_tag": str,
            "options": List[str],   # newest-first, deduped, includes default_tag
            "source": "docker_hub" | "fallback" | "cache",
        }
    """
    if key not in IMAGE_REPOS:
        raise KeyError(f"Unknown image catalog key: {key}")

    entry = IMAGE_REPOS[key]
    repo = entry["repo"]
    default_tag = entry["default_tag"]
    fallback_tags = entry["fallback_tags"]

    now = time.monotonic()
    lock = _locks.setdefault(repo, asyncio.Lock())

    if not force_refresh and repo in _cache:
        fetched_at, cached_tags = _cache[repo]
        if now - fetched_at < CACHE_TTL_SECONDS:
            options = _merge_default(cached_tags, default_tag)
            return {
                "label": entry["label"],
                "description": entry["description"],
                "repo": repo,
                "default_tag": default_tag,
                "options": options,
                "source": "cache",
            }

    async with lock:
        # Re-check cache after acquiring the lock in case another request
        # already refreshed it while we were waiting.
        if not force_refresh and repo in _cache:
            fetched_at, cached_tags = _cache[repo]
            if now - fetched_at < CACHE_TTL_SECONDS:
                options = _merge_default(cached_tags, default_tag)
                return {
                    "label": entry["label"],
                    "description": entry["description"],
                    "repo": repo,
                    "default_tag": default_tag,
                    "options": options,
                    "source": "cache",
                }

        try:
            tags = await _fetch_tags_from_docker_hub(repo)
            if not tags:
                raise RuntimeError(f"No valid semver tags found for {repo}")
            _cache[repo] = (time.monotonic(), tags)
            source = "docker_hub"
        except Exception as e:
            logger.warning(f"image_catalog: failed to fetch tags for {repo}, using fallback list: {e}")
            tags = fallback_tags
            source = "fallback"

    options = _merge_default(tags, default_tag)
    return {
        "label": entry["label"],
        "description": entry["description"],
        "repo": repo,
        "default_tag": default_tag,
        "options": options,
        "source": source,
    }


def _merge_default(tags: List[str], default_tag: str) -> List[str]:
    """Ensure the built-in default tag is always present in the options list."""
    if default_tag in tags:
        return tags
    return _filter_and_sort_tags(tags + [default_tag], limit=len(tags) + 1)


async def get_full_catalog(force_refresh: bool = False) -> Dict[str, Dict[str, Any]]:
    """Fetch the version catalog for all known image keys concurrently."""
    results = await asyncio.gather(
        *(get_versions(key, force_refresh=force_refresh) for key in IMAGE_REPOS),
        return_exceptions=True,
    )
    catalog: Dict[str, Dict[str, Any]] = {}
    for key, result in zip(IMAGE_REPOS.keys(), results):
        if isinstance(result, Exception):
            # Should not normally happen since get_versions() catches its own
            # errors, but guard against unexpected exceptions (e.g. bad key).
            entry = IMAGE_REPOS[key]
            logger.error(f"image_catalog: unexpected error for {key}: {result}")
            catalog[key] = {
                "label": entry["label"],
                "description": entry["description"],
                "repo": entry["repo"],
                "default_tag": entry["default_tag"],
                "options": entry["fallback_tags"],
                "source": "fallback",
            }
        else:
            catalog[key] = result
    return catalog


def is_valid_custom_tag(tag: str) -> bool:
    """
    Conservative validation for user-supplied custom image tags/refs before
    they are stored and later passed to a container runtime command.

    Allows typical Docker image reference characters: registry hosts, repo
    paths, and tags (e.g. "docker.io/vllm/vllm-openai:v0.30.0", "nightly",
    "v0.29.0-cu129"). Rejects whitespace and shell-special characters.
    """
    if not tag or len(tag) > 256:
        return False
    return re.match(r"^[A-Za-z0-9_][A-Za-z0-9_./:-]*$", tag) is not None
