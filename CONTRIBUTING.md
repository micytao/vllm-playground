# Contributing to vLLM Playground

Thank you for your interest in contributing to vLLM Playground!

## Project Structure

This project follows a **single source of truth** pattern:

```
vllm-playground/
├── run.py                    # Development entry point
├── pyproject.toml            # Package configuration
├── requirements.txt          # Dependencies
├── vllm_playground/          # <- ALL SOURCE CODE LIVES HERE
│   ├── __init__.py
│   ├── app.py                # Main FastAPI application
│   ├── cli.py                # CLI entry point
│   ├── container_manager.py  # Container runtime management
│   ├── index.html            # Web UI template
│   ├── static/               # CSS, JavaScript
│   ├── assets/               # Images, icons
│   ├── mcp_client/           # MCP integration
│   └── ...
├── docs/                     # Documentation
├── scripts/                  # Utility scripts
├── assets/                   # README images (GitHub URLs)
└── ...
```

### Important: Single Source of Truth

**All source code lives in `vllm_playground/`** - the package directory.

Do NOT create these files at the root level:
- `app.py`
- `container_manager.py`
- `index.html`
- `static/`
- `mcp_client/`
- `config/`
- `recipes/`

These are blocked by `.gitignore` to prevent accidental duplication.

## Development Workflow

### Setting Up Your Environment

```bash
# 1. Fork and clone the repository
git clone https://github.com/YOUR_USERNAME/vllm-playground.git
cd vllm-playground

# 2. Install with dev dependencies
pip install -e ".[dev]"

# 3. Set up pre-commit hooks (one-time setup)
pre-commit install
```

After running `pre-commit install`, code formatting and linting will run automatically on every commit.

### Running Locally

```bash
# Option 1: Direct run (recommended for development)
python run.py

# Option 2: Editable install
pip install -e .
vllm-playground
```

Both methods use the code in `vllm_playground/` - changes take effect immediately.

### Making Changes

1. **Fork and clone** the repository
2. **Create a branch**: `git checkout -b feat/your-feature`
3. **Edit files in `vllm_playground/`** (not at root!)
4. **Test locally**: `python run.py`
5. **Commit and push**: `git commit -m "feat: your feature"`
6. **Create a Pull Request**

### Verifying Structure

Run the verification script to ensure proper structure:

```bash
python scripts/verify_structure.py
```

This will report any files that shouldn't exist at root level.

## Code Style

This project uses **pre-commit hooks** to enforce consistent code style automatically:

- **Python**: Formatted by [Ruff](https://docs.astral.sh/ruff/)

When you commit, pre-commit will automatically format your code. If files are modified, simply stage the changes and commit again:

```bash
git add -A
git commit -m "your message"
```

To manually run formatting on all files:

```bash
pre-commit run --all-files
```

## Testing

Before submitting a PR, ensure:

1. `python run.py` starts the server successfully
2. Web UI loads at http://localhost:7860
3. Core features work (chat, server start/stop)

## Questions?

Open an issue on GitHub if you have questions about contributing.
