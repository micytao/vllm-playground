#!/usr/bin/env python3
"""
Sync vLLM Recipes from GitHub

This script fetches the latest recipes from the vLLM recipes repository
and updates the local recipes_catalog.json with any new models or changes.

The vLLM recipes repo structure:
  - Each folder (DeepSeek, Qwen, Llama, etc.) represents a model family
  - Each folder contains multiple .md files, one per model/variant
  - Each .md file contains vLLM serve commands with configuration

Usage:
    python recipes/sync_recipes.py
    
Or to just check what's available without updating:
    python recipes/sync_recipes.py --dry-run
"""

import argparse
import json
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    REQUESTS_AVAILABLE = False
    print("Warning: 'requests' package not installed. Install with: pip install requests")

# GitHub API configuration
GITHUB_API_BASE = "https://api.github.com"
RECIPES_REPO = "vllm-project/recipes"
RECIPES_URL = f"{GITHUB_API_BASE}/repos/{RECIPES_REPO}/contents"

# Local paths
SCRIPT_DIR = Path(__file__).parent
CATALOG_FILE = SCRIPT_DIR / "recipes_catalog.json"

# Category icons mapping (empty - no emojis)
CATEGORY_ICONS = {}


def get_github_token() -> Optional[str]:
    """Get GitHub token from environment for higher rate limits"""
    return os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")


def fetch_repo_contents(path: str = "") -> List[Dict[str, Any]]:
    """Fetch contents of the recipes repository"""
    if not REQUESTS_AVAILABLE:
        raise RuntimeError("requests package required. Install with: pip install requests")
    
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"
    
    url = f"{RECIPES_URL}/{path}" if path else RECIPES_URL
    response = requests.get(url, headers=headers, timeout=30)
    response.raise_for_status()
    return response.json()


def fetch_file_content(path: str) -> Optional[str]:
    """Fetch raw file content from GitHub"""
    if not REQUESTS_AVAILABLE:
        return None
    
    headers = {"Accept": "application/vnd.github.v3+json"}
    token = get_github_token()
    if token:
        headers["Authorization"] = f"token {token}"
    
    try:
        url = f"{RECIPES_URL}/{path}"
        response = requests.get(url, headers=headers, timeout=30)
        if response.status_code == 200:
            content_data = response.json()
            if content_data.get("encoding") == "base64":
                import base64
                return base64.b64decode(content_data["content"]).decode("utf-8")
    except Exception as e:
        print(f"    Warning: Could not fetch {path}: {e}")
    return None


def parse_vllm_command(content: str) -> Dict[str, Any]:
    """
    Parse vLLM serve command from markdown content.
    Extracts model ID and configuration parameters.
    """
    config = {}
    model_id = None
    
    # Find vllm serve commands in code blocks
    # Pattern matches: vllm serve <model_id> \ ... (multiline commands)
    serve_pattern = r'vllm\s+serve\s+([\w\-/\.]+)'
    serve_matches = re.findall(serve_pattern, content)
    
    if serve_matches:
        # Use the first model ID found (usually the main one)
        model_id = serve_matches[0]
    
    # Extract --tensor-parallel-size
    tp_pattern = r'--tensor[_-]parallel[_-]size[=\s]+(\d+)'
    tp_match = re.search(tp_pattern, content)
    if tp_match:
        config["tensor_parallel_size"] = int(tp_match.group(1))
    
    # Extract --max-model-len
    len_pattern = r'--max[_-]model[_-]len[=\s]+(\d+)'
    len_match = re.search(len_pattern, content)
    if len_match:
        config["max_model_len"] = int(len_match.group(1))
    
    # Extract --dtype
    dtype_pattern = r'--dtype[=\s]+(\w+)'
    dtype_match = re.search(dtype_pattern, content)
    if dtype_match:
        config["dtype"] = dtype_match.group(1)
    
    # Extract --gpu-memory-utilization
    gpu_mem_pattern = r'--gpu[_-]memory[_-]utilization[=\s]+([\d.]+)'
    gpu_mem_match = re.search(gpu_mem_pattern, content)
    if gpu_mem_match:
        config["gpu_memory_utilization"] = float(gpu_mem_match.group(1))
    
    # Extract --trust-remote-code
    if '--trust-remote-code' in content:
        config["trust_remote_code"] = True
    
    # Extract --enable-expert-parallel (for MoE models)
    if '--enable-expert-parallel' in content:
        config["enable_expert_parallel"] = True
    
    # Extract --data-parallel-size
    dp_pattern = r'--data[_-]parallel[_-]size[=\s]+(\d+)'
    dp_match = re.search(dp_pattern, content)
    if dp_match:
        config["data_parallel_size"] = int(dp_match.group(1))
    
    # Extract pipeline parallelism
    pp_pattern = r'--pipeline[_-]parallel[_-]size[=\s]+(\d+)'
    pp_match = re.search(pp_pattern, content)
    if pp_match:
        config["pipeline_parallel_size"] = int(pp_match.group(1))
    
    return {
        "model_id": model_id,
        "config": config
    }


def parse_hardware_info(content: str) -> Dict[str, str]:
    """
    Parse hardware requirements from markdown content.
    Looks for GPU specifications in headings and text.
    """
    hardware = {
        "recommended": "See documentation",
        "minimum": "See documentation"
    }
    
    # Look for GPU specs in headings like "Serving on 8xH200 (or H20) GPUs"
    gpu_heading_pattern = r'(?:Serving|Running|Deploy)[^\n]*?(\d+)\s*x?\s*(H100|H200|H20|A100|A10|RTX\s*\d+|V100|L40|L4)[^\n]*?(?:\((\d+)GB)?'
    gpu_match = re.search(gpu_heading_pattern, content, re.IGNORECASE)
    if gpu_match:
        count = gpu_match.group(1)
        gpu_type = gpu_match.group(2).upper().replace(" ", "")
        memory = gpu_match.group(3)
        if memory:
            hardware["recommended"] = f"{count}x {gpu_type} {memory}GB"
        else:
            hardware["recommended"] = f"{count}x {gpu_type}"
    
    # Also look for patterns like "8x H100 80GB"
    simple_gpu_pattern = r'(\d+)\s*x\s*(H100|H200|A100|A10|RTX\s*\d+|V100|L40|L4)\s*(?:(\d+)\s*GB)?'
    simple_matches = re.findall(simple_gpu_pattern, content, re.IGNORECASE)
    if simple_matches and hardware["recommended"] == "See documentation":
        count, gpu_type, memory = simple_matches[0]
        if memory:
            hardware["recommended"] = f"{count}x {gpu_type.upper()} {memory}GB"
        else:
            hardware["recommended"] = f"{count}x {gpu_type.upper()}"
    
    return hardware


def parse_model_name(content: str, filename: str) -> str:
    """
    Extract model name from content or filename.
    """
    # Try to get from title (# Model Usage Guide)
    title_pattern = r'^#\s+(.+?)(?:\s+Usage\s+Guide|\s+Guide)?$'
    title_match = re.search(title_pattern, content, re.MULTILINE)
    if title_match:
        return title_match.group(1).strip()
    
    # Fall back to filename without .md
    return filename.replace('.md', '').replace('_', ' ')


def parse_description(content: str, model_name: str) -> str:
    """
    Extract description from the introduction section.
    """
    # Look for text after "Introduction" or at the start
    intro_pattern = r'##\s*Introduction\s*\n+(.+?)(?:\n##|\n```|\Z)'
    intro_match = re.search(intro_pattern, content, re.DOTALL)
    if intro_match:
        # Get first paragraph
        text = intro_match.group(1).strip()
        # Remove markdown links
        text = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', text)
        # Get first sentence or first 200 chars
        first_sentence = re.split(r'(?<=[.!?])\s', text)[0]
        if len(first_sentence) > 200:
            return first_sentence[:200] + "..."
        return first_sentence
    
    return f"{model_name} - from vLLM recipes"


def extract_tags(content: str, config: Dict[str, Any]) -> List[str]:
    """
    Extract tags based on content and configuration.
    """
    tags = []
    content_lower = content.lower()
    
    # Size/GPU tags
    tp = config.get("tensor_parallel_size", 1)
    if tp >= 8:
        tags.append("multi-gpu")
        tags.append("large")
    elif tp >= 2:
        tags.append("multi-gpu")
    else:
        tags.append("single-gpu")
    
    # Feature tags
    if "vision" in content_lower or "vl" in content_lower or "image" in content_lower:
        tags.append("vision")
    if "multimodal" in content_lower:
        tags.append("multimodal")
    if "ocr" in content_lower:
        tags.append("ocr")
    if "reasoning" in content_lower or "think" in content_lower:
        tags.append("reasoning")
    if "coder" in content_lower or "code" in content_lower:
        tags.append("coding")
    if "instruct" in content_lower:
        tags.append("instruct")
    if "chat" in content_lower:
        tags.append("chat")
    if "moe" in content_lower or "expert" in content_lower or config.get("enable_expert_parallel"):
        tags.append("moe")
    if "rerank" in content_lower:
        tags.append("reranking")
    if "embed" in content_lower:
        tags.append("embeddings")
    if "tpu" in content_lower:
        tags.append("tpu")
    if "fp8" in content_lower:
        tags.append("fp8")
    
    return list(set(tags))  # Remove duplicates


def parse_recipe_file(content: str, filename: str, folder_name: str) -> Optional[Dict[str, Any]]:
    """
    Parse a single recipe .md file and extract recipe information.
    """
    # Parse vLLM command for model_id and config
    parsed = parse_vllm_command(content)
    model_id = parsed["model_id"]
    config = parsed["config"]
    
    if not model_id:
        # Try to find model ID in other patterns
        # e.g., HuggingFace links: huggingface.co/org/model
        hf_pattern = r'huggingface\.co/([\w-]+/[\w.-]+)'
        hf_match = re.search(hf_pattern, content)
        if hf_match:
            model_id = hf_match.group(1)
    
    if not model_id:
        print(f"    Skipping {filename}: No model ID found")
        return None
    
    # Parse other info
    model_name = parse_model_name(content, filename)
    description = parse_description(content, model_name)
    hardware = parse_hardware_info(content)
    tags = extract_tags(content, config)
    
    # Generate recipe ID from filename
    recipe_id = filename.replace('.md', '').lower().replace(' ', '-').replace('_', '-')
    
    # Check if HuggingFace token is likely required
    requires_hf_token = "meta-llama" in model_id.lower() or "llama" in model_id.lower()
    
    recipe = {
        "id": recipe_id,
        "name": model_name,
        "description": description,
        "model_id": model_id,
        "docs_url": f"https://github.com/{RECIPES_REPO}/tree/main/{folder_name}",
        "hardware": hardware,
        "config": config,
        "tags": tags
    }
    
    if requires_hf_token:
        recipe["requires_hf_token"] = True
    
    return recipe


def discover_recipes() -> Dict[str, Any]:
    """
    Discover all available recipes from the GitHub repository.
    Returns a dictionary of discovered model families and their recipes.
    """
    discovered = {}
    
    print(f"Fetching recipes from {RECIPES_REPO}...")
    
    try:
        contents = fetch_repo_contents()
    except Exception as e:
        print(f"Error fetching repository contents: {e}")
        return discovered
    
    # Filter to directories (model families)
    model_dirs = [
        item for item in contents 
        if item["type"] == "dir" and not item["name"].startswith(".")
    ]
    
    print(f"Found {len(model_dirs)} model directories")
    
    for model_dir in model_dirs:
        dir_name = model_dir["name"]
        print(f"  Processing: {dir_name}")
        
        try:
            # Fetch directory contents to get all .md files
            dir_contents = fetch_repo_contents(dir_name)
            
            # Filter to .md files
            md_files = [
                item for item in dir_contents 
                if item["type"] == "file" and item["name"].lower().endswith('.md')
            ]
            
            print(f"    Found {len(md_files)} .md files")
            
            recipes = []
            for md_file in md_files:
                filename = md_file["name"]
                file_path = f"{dir_name}/{filename}"
                
                # Fetch file content
                content = fetch_file_content(file_path)
                if content:
                    recipe = parse_recipe_file(content, filename, dir_name)
                    if recipe:
                        recipes.append(recipe)
                        print(f"      ✓ {filename} -> {recipe['model_id']}")
            
            discovered[dir_name] = {
                "name": dir_name,
                "url": f"https://github.com/{RECIPES_REPO}/tree/main/{dir_name}",
                "recipes": recipes
            }
            
        except Exception as e:
            print(f"    Warning: Could not process {dir_name}: {e}")
    
    return discovered


def load_current_catalog() -> Dict[str, Any]:
    """Load the current recipes catalog"""
    if CATALOG_FILE.exists():
        with open(CATALOG_FILE, "r") as f:
            return json.load(f)
    return {"metadata": {}, "categories": []}


def save_catalog(catalog: Dict[str, Any]) -> None:
    """Save the recipes catalog"""
    catalog["metadata"]["last_updated"] = datetime.now().strftime("%Y-%m-%d")
    with open(CATALOG_FILE, "w") as f:
        json.dump(catalog, f, indent=2)


def update_catalog_with_discoveries(
    catalog: Dict[str, Any], 
    discovered: Dict[str, Any],
    force_update: bool = False
) -> Tuple[Dict[str, Any], Dict[str, int]]:
    """
    Update the catalog with newly discovered recipes.
    
    If force_update is True, replaces existing categories with discovered ones.
    Otherwise, only adds new categories and new recipes to existing categories.
    
    Returns the updated catalog and stats about changes.
    """
    existing_categories = {cat["id"]: cat for cat in catalog.get("categories", [])}
    
    # Map discovered folder names to category IDs
    folder_to_id = {
        "DeepSeek": "deepseek",
        "Qwen": "qwen", 
        "Llama": "llama",
        "Mistral": "mistral",
        "InternVL": "internvl",
        "InternLM": "internvl",  # Combine with InternVL
        "GLM": "glm",
        "NVIDIA": "nvidia",
        "moonshotai": "moonshotai",
        "MiniMax": "minimax",
        "Jina": "jina",
        "Tencent-Hunyuan": "hunyuan",
        "Ernie": "ernie",
        "Google": "google",
        "PaddlePaddle": "paddle",
        "Seed": "seed",
        "inclusionAI": "inclusionai",
        "ARC-AGI": "arcagi",
    }
    
    stats = {
        "new_categories": 0,
        "updated_categories": 0,
        "new_recipes": 0,
        "total_recipes": 0
    }
    
    for folder_name, info in discovered.items():
        cat_id = folder_to_id.get(folder_name, folder_name.lower().replace("-", "").replace("_", ""))
        recipes = info.get("recipes", [])
        
        if not recipes:
            continue
        
        stats["total_recipes"] += len(recipes)
        
        if cat_id not in existing_categories:
            # Create a new category
            new_cat = {
                "id": cat_id,
                "name": folder_name,
                "icon": CATEGORY_ICONS.get(cat_id, "🤖"),
                "description": f"{folder_name} models from vLLM recipes",
                "recipes": recipes
            }
            catalog["categories"].append(new_cat)
            existing_categories[cat_id] = new_cat
            stats["new_categories"] += 1
            stats["new_recipes"] += len(recipes)
            print(f"  ➕ Added new category: {folder_name} with {len(recipes)} recipes")
        
        elif force_update:
            # Replace existing category recipes
            existing_cat = existing_categories[cat_id]
            old_count = len(existing_cat.get("recipes", []))
            existing_cat["recipes"] = recipes
            stats["updated_categories"] += 1
            stats["new_recipes"] += len(recipes) - old_count
            print(f"  🔄 Updated category: {folder_name} ({old_count} -> {len(recipes)} recipes)")
        
        else:
            # Add only new recipes to existing category
            existing_cat = existing_categories[cat_id]
            existing_recipe_ids = {r["id"] for r in existing_cat.get("recipes", [])}
            new_recipes = [r for r in recipes if r["id"] not in existing_recipe_ids]
            if new_recipes:
                existing_cat["recipes"].extend(new_recipes)
                stats["new_recipes"] += len(new_recipes)
                print(f"  ➕ Added {len(new_recipes)} new recipes to {folder_name}")
    
    return catalog, stats


def print_discovery_report(discovered: Dict[str, Any]) -> None:
    """Print a summary of discovered recipes"""
    print("\n" + "=" * 60)
    print("DISCOVERY REPORT")
    print("=" * 60)
    
    total_recipes = 0
    for folder_name, info in sorted(discovered.items()):
        recipes = info.get("recipes", [])
        recipe_count = len(recipes)
        total_recipes += recipe_count
        
        print(f"\n📁 {folder_name}")
        print(f"   URL: {info['url']}")
        print(f"   Recipes found: {recipe_count}")
        
        for recipe in recipes[:5]:  # Show first 5
            tags = ", ".join(recipe.get("tags", [])[:3])
            print(f"      - {recipe['name']}: {recipe['model_id']}")
            if tags:
                print(f"        Tags: {tags}")
        
        if recipe_count > 5:
            print(f"      ... and {recipe_count - 5} more")
    
    print("\n" + "-" * 60)
    print(f"Total: {len(discovered)} model families, {total_recipes} recipes discovered")
    print("=" * 60)


def print_catalog_summary(catalog: Dict[str, Any]) -> None:
    """Print summary of the current catalog for API response parsing"""
    categories = catalog.get("categories", [])
    total_recipes = sum(len(cat.get("recipes", [])) for cat in categories)
    last_updated = catalog.get("metadata", {}).get("last_updated", "unknown")
    
    print(f"\nCategories: {len(categories)}")
    print(f"Total Recipes: {total_recipes}")
    print(f"Last Updated: {last_updated}")


def main():
    parser = argparse.ArgumentParser(description="Sync vLLM recipes from GitHub")
    parser.add_argument(
        "--dry-run", 
        action="store_true",
        help="Only show what would be discovered, don't update catalog"
    )
    parser.add_argument(
        "--force",
        action="store_true", 
        help="Force update existing categories with discovered recipes"
    )
    args = parser.parse_args()
    
    if not REQUESTS_AVAILABLE:
        print("Error: 'requests' package is required.")
        print("Install with: pip install requests")
        return 1
    
    # Discover recipes from GitHub
    discovered = discover_recipes()
    
    if not discovered:
        print("No recipes discovered. Check your network connection or GitHub rate limits.")
        print("Tip: Set GITHUB_TOKEN environment variable for higher rate limits.")
        return 1
    
    # Print report
    print_discovery_report(discovered)
    
    if args.dry_run:
        print("\n[DRY RUN] No changes made to catalog.")
        return 0
    
    # Load and update catalog
    catalog = load_current_catalog()
    updated_catalog, stats = update_catalog_with_discoveries(catalog, discovered, args.force)
    
    # Save updated catalog
    save_catalog(updated_catalog)
    print(f"\n✅ Catalog updated: {CATALOG_FILE}")
    print(f"   New categories: {stats['new_categories']}")
    print(f"   Updated categories: {stats['updated_categories']}")
    print(f"   New recipes added: {stats['new_recipes']}")
    
    # Print summary for API response
    print_catalog_summary(updated_catalog)
    
    return 0


if __name__ == "__main__":
    exit(main())
