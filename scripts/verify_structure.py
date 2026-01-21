#!/usr/bin/env python3
"""
Verify project structure for single-source-of-truth compliance.

This script checks that no duplicate source files exist at the root level.
All source code should live in vllm_playground/ only.

Usage:
    python scripts/verify_structure.py [--fix]

Options:
    --fix   Remove duplicate files found at root (use with caution)
"""

import argparse
import sys
from pathlib import Path

# Project root directory
ROOT_DIR = Path(__file__).parent.parent
PKG_DIR = ROOT_DIR / "vllm_playground"

# Files/directories that should NOT exist at root (they belong in vllm_playground/)
FORBIDDEN_AT_ROOT = [
    "app.py",
    "container_manager.py", 
    "index.html",
    "benchmarks.json",
    "static",
    "mcp_client",
    "config",
    "recipes",
]

# Files that ARE allowed at root (not duplicates)
ALLOWED_AT_ROOT = [
    "run.py",
    "pyproject.toml",
    "requirements.txt",
    "README.md",
    "CHANGELOG.md",
    "LICENSE",
    "MANIFEST.in",
    "CONTRIBUTING.md",
    "env.example",
    ".gitignore",
    ".containerignore",
    "assets",  # README images referenced by GitHub URLs
    "docs",
    "scripts",
    "containers",
    "deployments",
    "openshift",
    "releases",
    "cli_demo",
    "dist",
    "vllm_playground",
]


def check_structure(fix: bool = False) -> bool:
    """
    Check that no forbidden files exist at root.
    
    Returns:
        True if structure is valid, False otherwise
    """
    print("=" * 60)
    print("🔍 vLLM Playground - Structure Verification")
    print("=" * 60)
    print(f"Root:    {ROOT_DIR}")
    print(f"Package: {PKG_DIR}")
    print("=" * 60)
    print()
    
    issues_found = []
    
    for item in FORBIDDEN_AT_ROOT:
        path = ROOT_DIR / item
        if path.exists():
            issues_found.append(path)
            print(f"❌ Found forbidden file/directory at root: {item}")
            if fix:
                if path.is_file():
                    path.unlink()
                    print(f"   🗑️  Deleted: {item}")
                else:
                    import shutil
                    shutil.rmtree(path)
                    print(f"   🗑️  Deleted directory: {item}/")
    
    if not issues_found:
        print("✅ Structure is valid - all source code is in vllm_playground/")
        print()
        print("📁 Single Source of Truth:")
        print("   All source files live in vllm_playground/")
        print("   run.py imports from vllm_playground.app")
        print("   pip install uses vllm_playground/ package")
        return True
    else:
        print()
        if fix:
            print(f"🔧 Fixed {len(issues_found)} issue(s)")
            return True
        else:
            print(f"⚠️  Found {len(issues_found)} duplicate(s) at root level")
            print()
            print("These files should only exist in vllm_playground/")
            print("Run with --fix to remove them, or delete manually.")
            print()
            print("Note: If you're migrating, make sure vllm_playground/")
            print("contains the latest version before deleting root copies.")
            return False


def main():
    parser = argparse.ArgumentParser(
        description="Verify single-source-of-truth project structure"
    )
    parser.add_argument(
        '--fix', 
        action='store_true', 
        help="Remove duplicate files found at root"
    )
    args = parser.parse_args()
    
    valid = check_structure(fix=args.fix)
    sys.exit(0 if valid else 1)


if __name__ == "__main__":
    main()
