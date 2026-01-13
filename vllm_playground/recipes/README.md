# vLLM Community Recipes Integration

This folder contains the integration with the [vLLM Recipes Repository](https://github.com/vllm-project/recipes), providing optimized configurations for running various models with vLLM.

## 📁 Files

- **`recipes_catalog.json`** - Local catalog of model recipes with optimized configurations
- **`sync_recipes.py`** - Script to sync/update recipes from GitHub

## 🚀 Usage

### In the Web UI

1. Click the **"📚 Browse Community Recipes"** button in the model selection area
2. Browse recipes by model family (DeepSeek, Qwen, Llama, etc.)
3. Use the search bar to find specific models
4. Filter by tags (single-gpu, multi-gpu, cpu, vision, reasoning)
5. Click **"⚡ Load Config"** to auto-fill the playground configuration

### Update Recipes

To fetch the latest recipes from GitHub:

```bash
# Basic sync
python recipes/sync_recipes.py

# Dry run (show what would be discovered)
python recipes/sync_recipes.py --dry-run
```

**Note:** The sync script requires the `requests` package:
```bash
pip install requests
```

### Set GitHub Token (Optional)

For higher API rate limits:

```bash
export GITHUB_TOKEN=your_token_here
python recipes/sync_recipes.py
```

## 📋 Catalog Structure

The `recipes_catalog.json` file is structured as:

```json
{
  "metadata": {
    "source": "https://github.com/vllm-project/recipes",
    "last_updated": "2024-12-18"
  },
  "categories": [
    {
      "id": "qwen",
      "name": "Qwen",
      "icon": "🌟",
      "description": "Alibaba's Qwen model family",
      "recipes": [
        {
          "id": "qwen3-8b",
          "name": "Qwen3-8B",
          "model_id": "Qwen/Qwen3-8B",
          "description": "...",
          "docs_url": "https://github.com/vllm-project/recipes/tree/main/Qwen",
          "hardware": {
            "recommended": "1x A100 40GB",
            "minimum": "1x RTX 3090"
          },
          "config": {
            "tensor_parallel_size": 1,
            "max_model_len": 32768,
            "dtype": "auto"
          },
          "tags": ["efficient", "single-gpu", "chat"]
        }
      ]
    }
  ]
}
```

## 🏷️ Available Tags

| Tag | Description |
|-----|-------------|
| `single-gpu` | Runs on a single GPU |
| `multi-gpu` | Requires multiple GPUs |
| `cpu` | CPU-friendly / CPU-only |
| `vision` | Vision/multimodal capabilities |
| `reasoning` | Optimized for reasoning tasks |
| `coding` | Coding-focused models |
| `moe` | Mixture of Experts architecture |
| `efficient` | Optimized for efficiency |
| `large` | Large model (100B+ parameters) |

## 🤝 Contributing

To add new recipes:

1. Add entries to `recipes_catalog.json`
2. Include all required fields (id, name, model_id, config, etc.)
3. Test the configuration in the playground
4. Submit a PR!

Alternatively, contribute directly to the upstream [vLLM Recipes Repository](https://github.com/vllm-project/recipes).

## 🔗 Links

- [vLLM Recipes Repository](https://github.com/vllm-project/recipes)
- [vLLM Documentation](https://docs.vllm.ai/)
- [vLLM GitHub](https://github.com/vllm-project/vllm)
