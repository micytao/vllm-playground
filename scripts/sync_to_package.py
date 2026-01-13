#!/usr/bin/env python3
"""
Sync files from root directory to vllm_playground package directory.

This script copies files from the root (used for direct cloning/running) to the
package directory (used for PyPI distribution), applying necessary transformations.

Usage:
    python scripts/sync_to_package.py [--dry-run] [--verbose]

Options:
    --dry-run   Show what would be synced without making changes
    --verbose   Show detailed output
"""

import os
import shutil
import argparse
import hashlib
from pathlib import Path
from datetime import datetime


# Project root directory
ROOT_DIR = Path(__file__).parent.parent
PKG_DIR = ROOT_DIR / "vllm_playground"


# Files/directories to sync (source relative to ROOT_DIR)
# Format: (source, destination_relative_to_PKG_DIR, transform_function_or_None)
SYNC_FILES = [
    # Python files with transformations
    ("app.py", "app.py", "transform_app_py"),
    ("container_manager.py", "container_manager.py", None),
    # Static files (direct copy)
    ("index.html", "index.html", None),
    ("benchmarks.json", "benchmarks.json", None),
    # Directories (recursive copy)
    ("static", "static", None),
    ("assets", "assets", None),
    ("config", "config", None),
    ("recipes", "recipes", None),
    ("mcp_client", "mcp_client", None),  # MCP client module
]

# Files/directories to skip in package (package-specific, don't overwrite)
SKIP_IN_PACKAGE = [
    "__init__.py",
    "cli.py",
    "__pycache__",
]


def get_file_hash(filepath: Path) -> str:
    """Calculate MD5 hash of a file"""
    if not filepath.exists():
        return ""
    with open(filepath, "rb") as f:
        return hashlib.md5(f.read()).hexdigest()


def transform_app_py(content: str) -> str:
    """
    Transform app.py for package distribution.

    Changes:
    1. Simplify container_manager import to use only relative import
    2. Transform MCP imports from absolute to relative
    """

    result = content

    # Transform container_manager import block
    # Root version has try absolute, then try relative fallback
    # Package version should only use relative import

    old_import_block = """# Import container manager (optional - only needed for container mode)
container_manager = None  # Initialize as None for when import fails
CONTAINER_MODE_AVAILABLE = False
try:
    # Try absolute import first (for running from root directory)
    from container_manager import container_manager
    # container_manager will be None if no runtime (podman/docker) is available
    CONTAINER_MODE_AVAILABLE = container_manager is not None
    if not CONTAINER_MODE_AVAILABLE:
        logger.warning("No container runtime (podman/docker) found - container mode will be disabled")
except ImportError:
    try:
        # Fall back to relative import (for package mode)
        from .container_manager import container_manager
        CONTAINER_MODE_AVAILABLE = container_manager is not None
        if not CONTAINER_MODE_AVAILABLE:
            logger.warning("No container runtime (podman/docker) found - container mode will be disabled")
    except ImportError:
        CONTAINER_MODE_AVAILABLE = False
        logger.warning("container_manager not available - container mode will be disabled")"""

    new_import_block = """# Import container manager (optional - only needed for container mode)
container_manager = None  # Initialize as None for when import fails
CONTAINER_MODE_AVAILABLE = False
try:
    from .container_manager import container_manager
    # container_manager will be None if no runtime (podman/docker) is available
    CONTAINER_MODE_AVAILABLE = container_manager is not None
    if not CONTAINER_MODE_AVAILABLE:
        logger.warning("No container runtime (podman/docker) found - container mode will be disabled")
except ImportError:
    CONTAINER_MODE_AVAILABLE = False
    logger.warning("container_manager not available - container mode will be disabled")"""

    if old_import_block in result:
        result = result.replace(old_import_block, new_import_block)
        print("  ✓ Transformed container_manager imports (absolute+fallback → relative only)")
    elif "from .container_manager import container_manager" in result:
        print("  ℹ️  container_manager already uses relative import")

    # Additional transforms for robustness (applied regardless of container_manager state)

    # Add guard to read_logs_container function if not present
    if "async def read_logs_container():" in result and "if not container_manager:" not in result:
        result = result.replace(
            'async def read_logs_container():\n    """Read logs from vLLM container"""\n    global vllm_running\n    \n    try:',
            'async def read_logs_container():\n    """Read logs from vLLM container"""\n    global vllm_running\n    \n    if not container_manager:\n        logger.error("read_logs_container called but container_manager is not available")\n        return\n    \n    try:',
        )

    # Fix container mode validation check
    if 'if config.run_mode == "container" and not CONTAINER_MODE_AVAILABLE:' in result:
        result = result.replace(
            'if config.run_mode == "container" and not CONTAINER_MODE_AVAILABLE:',
            'if config.run_mode == "container" and (not CONTAINER_MODE_AVAILABLE or not container_manager):',
        )

    # Transform MCP imports: Convert absolute imports to relative imports for package
    # Root uses: from mcp_client import ...
    # Package needs: from .mcp_client import ...

    # Transform the main MCP import section
    result = result.replace(
        "from mcp_client import MCP_AVAILABLE, MCP_VERSION",
        "from .mcp_client import MCP_AVAILABLE, MCP_VERSION",
    )
    result = result.replace(
        "from mcp_client.manager import get_mcp_manager",
        "from .mcp_client.manager import get_mcp_manager",
    )
    result = result.replace(
        "from mcp_client.config import MCPServerConfig, MCPTransport, MCP_PRESETS",
        "from .mcp_client.config import MCPServerConfig, MCPTransport, MCP_PRESETS",
    )

    # Check if transforms were applied
    if "from .mcp_client import" in result:
        print("  ✓ Transformed MCP imports (absolute → relative)")

    return result


def sync_file(src: Path, dst: Path, transform_func=None, dry_run=False, verbose=False):
    """Sync a single file"""

    # Read source
    with open(src, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    # Apply transformation if specified
    if transform_func:
        transform = globals().get(transform_func)
        if transform:
            content = transform(content)

    # Check if destination exists and is different
    if dst.exists():
        with open(dst, "r", encoding="utf-8", errors="replace") as f:
            existing = f.read()
        if existing == content:
            if verbose:
                print(f"  ⏭️  {src.name} (unchanged)")
            return False

    if dry_run:
        print(f"  📝 Would sync: {src} → {dst}")
        return True

    # Write to destination
    dst.parent.mkdir(parents=True, exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"  ✅ Synced: {src.name}")
    return True


def sync_directory(src: Path, dst: Path, dry_run=False, verbose=False):
    """Sync a directory recursively"""

    synced = 0

    if not src.exists():
        print(f"  ⚠️  Source directory not found: {src}")
        return 0

    for item in src.rglob("*"):
        if item.is_file():
            # Skip __pycache__ and other ignored patterns
            if any(skip in str(item) for skip in ["__pycache__", ".pyc", ".DS_Store"]):
                continue

            rel_path = item.relative_to(src)
            dst_file = dst / rel_path

            # Check if file is different
            if dst_file.exists():
                if get_file_hash(item) == get_file_hash(dst_file):
                    if verbose:
                        print(f"  ⏭️  {rel_path} (unchanged)")
                    continue

            if dry_run:
                print(f"  📝 Would sync: {rel_path}")
                synced += 1
            else:
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, dst_file)
                if verbose:
                    print(f"  ✅ Synced: {rel_path}")
                synced += 1

    return synced


def main():
    parser = argparse.ArgumentParser(description="Sync files from root to package directory")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be synced")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    print("=" * 60)
    print("🔄 vLLM Playground - Sync to Package")
    print("=" * 60)
    print(f"Root:    {ROOT_DIR}")
    print(f"Package: {PKG_DIR}")
    if args.dry_run:
        print("Mode:    DRY RUN (no changes will be made)")
    print("=" * 60)
    print()

    total_synced = 0

    for src_rel, dst_rel, transform in SYNC_FILES:
        src = ROOT_DIR / src_rel
        dst = PKG_DIR / dst_rel

        if not src.exists():
            print(f"⚠️  Source not found: {src_rel}")
            continue

        print(f"📁 {src_rel}" + (f" (with transforms)" if transform else ""))

        if src.is_file():
            if sync_file(src, dst, transform, args.dry_run, args.verbose):
                total_synced += 1
        else:
            synced = sync_directory(src, dst, args.dry_run, args.verbose)
            if synced > 0:
                print(f"   ({synced} files)")
            total_synced += synced

    print()
    print("=" * 60)
    if args.dry_run:
        print(f"📊 Would sync {total_synced} file(s)")
    else:
        print(f"✅ Synced {total_synced} file(s)")
    print("=" * 60)

    if not args.dry_run and total_synced > 0:
        print()
        print("💡 Next steps:")
        print("   1. Review changes: git diff vllm_playground/")
        print("   2. Test locally: python -c 'from vllm_playground import app'")
        print("   3. Build package: python -m build")


if __name__ == "__main__":
    main()
