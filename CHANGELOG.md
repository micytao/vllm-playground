# Changelog

All notable changes to vLLM Playground are documented here.

For detailed release notes, see the [releases/](releases/) folder.

---

## [v0.1.7](releases/v0.1.7.md) - 2026-03-03

**Hotfix & Tutorials**

### Fixed
- 🐛 **Container mode switching broken** - `getConfig()` was missing the `container` radio branch, causing container mode to silently send `remote` to the backend. Restored default to `container` (matching v0.1.5) and added explicit handling for all three modes.
- 🐛 **Logprobs tooltip clipped on first line** - Changed `.message-content` from `overflow: hidden` to `overflow: visible` so the probability tooltip is no longer cut off by the message container.
- 🐛 **Logprobs crash on Metal/CPU** - vLLM Metal/CPU backends crash with `IndexError` in `_create_chat_logprobs` when logprobs are enabled. Force non-streaming on Metal/CPU compute mode, with transparent fallback retry (without logprobs) on 500 errors. GPU and remote modes stream normally.
- 🐛 **Claude Code not detected on VPS/Linux** - `find_claude_command()` now checks `~/.local/bin/claude` and `~/.npm-global/bin/claude` as fallback paths, covering the official `curl` installer and common npm global setups. Also scans `/home/*/` directories when running as root/sudo (e.g., systemd services).
- 🐛 **Mode switch config leak** - Switching from container/subprocess to remote mode no longer carries over stale `served_model_name`, `enable_tool_calling`, and `tool_call_parser` values. These local-server fields are auto-cleared on mode switch, and `getConfig()` explicitly excludes them for remote mode as a safety net.
- 🐛 **Stale observability data after mode switch** - Metrics are now cleared when a new server starts, so the observability dashboard no longer shows data from a previous session after switching modes.

### Added
- 📖 **Tutorials** - New "Tutorials" nav item at the bottom of the navigation sidebar that embeds the [vLLM Workshop](https://micytao.github.io/vllm-workshop/) directly inside vLLM Playground via iframe, with lazy-loading and a fallback link.

---

## [v0.1.6](releases/v0.1.6.md) - 2026-03-02 (yanked)

**Observability Dashboard & Context Insights**

### Added
- 📊 **Observability Dashboard** - Full-page metrics dashboard with auto-discovery
  - Overview tab with categorized metric cards and threshold indicators
  - All Metrics tab with searchable, sortable table
  - Time Series tab with interactive uPlot charts (1m/5m/15m/1h windows)
  - Latency tab for TTFT, TPOT, and E2E latency metrics
  - Configurable threshold alerts with history log
  - Generic metrics architecture: metrics-registry, metrics-poller, observability modules
  - Export metrics data as JSON
- 🔍 **PagedAttention Visualizer** - Real-time KV cache context observability
  - Canvas-rendered block utilization heatmap
  - Circular usage gauge and prefix cache stats
  - Three-level eviction alerts (normal / warning / critical)
- 🔢 **Token Counter** - Live token estimation alongside chat input
  - Server-side `/tokenize` with character-based fallback
  - Conversation token gauge against `max_model_len`
- 🎨 **Logprobs Visualizer** - Per-token probability heatmap for assistant responses
  - Four confidence levels with hover tooltips for alternative tokens
  - BPE and SentencePiece token format support
- ⚡ **Speculative Decoding Dashboard** - Acceptance rate, speedup factor, token counts
  - Supports Eagle, Eagle3, MLP Speculator, Medusa, MTP, N-gram methods
  - Demo mode for testing without a live speculative decoding setup
- 💾 **Settings Persistence** - User preferences saved to `~/.vllm-playground/settings.json`
  - Theme, locale, layout, run mode, and remote URLs
  - Atomic writes with backup for crash safety

### Fixed
- Observability metrics accuracy and time-series persistence (#44)

### Documentation (Community)
- vLLM version updated to 0.15.0 in HTML template and installation guide (@nussejzz)
- OpenShift Containerfile and documentation patches (@turbra)

---

## [v0.1.5](releases/v0.1.5.md) - 2026-02-08

**Remote Server & VLM (Vision Language Model) Support**

### Added
- 🌐 **Remote vLLM Server** - Connect to any remote vLLM instance
  - New "Remote" run mode alongside Subprocess and Container
  - Remote URL and API key configuration
  - Auto-detected server info (models, health, max context, root model)
  - Full feature compatibility: Chat, GuideLLM, Claude Code, MCP Servers, Structured Outputs
  - Remote mode support for both vLLM Server and vLLM-Omni pages
- 🖼️ **VLM (Vision Language Model)** - Multimodal chat with vision models
  - Image upload via drag-and-drop or URL input
  - One-shot image attachment with inline chat thumbnails
  - OpenAI-compatible multimodal content format
  - Works in all modes: Subprocess, Container, Remote
  - Qwen2.5-VL-3B-Instruct added to model dropdown
- ✨ **Markdown Rendering** - Rich formatting for assistant messages
  - Bold, italic, headings, lists, code blocks, tables, blockquotes
  - Real-time rendering during streaming
  - Light and dark theme support

### Changed
- Structured outputs updated for vLLM v0.12+ API (`structured_outputs` dict format)
- Proxy timeouts increased for VLM image processing (sock_read: 30s -> 120s)
- Claude Code integration: added `ANTHROPIC_AUTH_TOKEN` for seamless login bypass
- Tool calling optimistically enabled in remote mode

### Fixed
- GuideLLM benchmark UI hanging at 98% (subprocess stdout/stderr deadlock)
- Claude Code "config required" error in remote mode
- Button label inconsistency when switching between run modes
- Chat input layout when VLM image indicator is shown

---

## [v0.1.4](releases/v0.1.4.md) - 2026-02-01

**vLLM-Omni Multimodal Integration**

### Added
- 🎨 **vLLM-Omni Integration** - Multimodal generation support
  - Image Generation (Text-to-Image) with DiT models (Z-Image-Turbo, Qwen-Image, SD3)
  - Image Editing (Image-to-Image) with Qwen-Image-Edit series
  - TTS (Text-to-Speech) with Qwen3-TTS models
  - Audio Generation (Music/SFX) with Stable Audio Open
  - Video Generation and Omni Chat (preview, coming soon)
- 🎬 **Studio UI** - Polished multimodal generation interface
  - Adaptive color themes per generation mode (Image, TTS, Audio)
  - Unified Gallery with lightbox viewer, download, and delete
  - Built-in media players for audio/video playback
  - Prompt templates for each generation type
- 🐳 **CLI Enhancement** - `vllm-playground pull --omni` for vLLM-Omni container
- 📚 **vLLM-Omni Recipes** - GPU-optimized configurations
  - Stable Audio Open 1.0
  - Qwen3-TTS Custom Voice, Voice Design, Base
- 🔧 **Pre-commit Hooks** - Code quality tooling
  - Ruff formatting for Python
  - File hygiene checks (trailing whitespace, YAML validation)
- 📖 Documentation: [vLLM-Omni Guide](docs/VLLM_OMNI_GUIDE.md)

### Changed
- vLLM-Omni runs on separate port (default: 8091) from main vLLM server
- Container images: `vllm/vllm-omni:v0.14.0rc1` (NVIDIA), `vllm/vllm-omni-rocm:v0.14.0rc1` (AMD)

### Fixed
- Various UI improvements and bug fixes for vLLM-Omni stability

---

## [v0.1.3](releases/v0.1.3.md) - 2026-01-22

**Multi-Accelerators, Claude Code & vLLM-Metal Support**

### Added
- 🎮 **Multi-Accelerators Support** - NVIDIA CUDA, AMD ROCm, Google Cloud TPU
  - Auto-detection via nvidia-smi, amd-smi, tpu-info
  - CLI pull flags: `--nvidia`, `--amd`, `--tpu`, `--cpu`, `--all`
  - Kubernetes detection for gpu/tpu resources
- 🤖 **Claude Code Integration** - Use open-source models as Claude Code backend
  - Web terminal via ttyd for Claude Code TUI
  - WebSocket proxy for cloud deployment support
  - API endpoints: start-terminal, stop-terminal, terminal-status
  - Recommended model configuration tips
- ⚡ **vLLM-Metal Support** - Apple Silicon GPU acceleration
  - Metal GPU mode for Apple Silicon (requires vllm-metal)
  - Custom virtual environment path (`venv_path`)
  - `compute_mode` configuration field with cpu/gpu/metal options
  - Multi-method vLLM detection (Python import → pip list → uv pip list)
- 📁 **Single Source Restructure** - All source code in `vllm_playground/`
  - Removed ~32,000 lines of duplicate root-level files
  - Added `CONTRIBUTING.md` with development guidelines
  - Added `scripts/verify_structure.py` for validation
- 📖 Documentation: [Custom venv Guide](docs/CUSTOM_VENV_GUIDE.md)
- 📖 Documentation: [macOS Metal Guide](docs/MACOS_METAL_GUIDE.md)

### Changed
- 🐳 **Container image updated to `vllm/vllm-openai:v0.12.0`** (required for Anthropic Messages API)
- `compute_mode` enum field replaces boolean `use_cpu` for clearer configuration
- Subprocess mode uses custom venv's Python interpreter when `venv_path` is specified
- Metal mode sets `VLLM_TARGET_DEVICE=metal` and `VLLM_USE_V1=1` environment variables
- Improved UI messaging to distinguish three vLLM states (not installed / installed without version / installed with version)
- Updated README with Metal GPU and custom venv quick start instructions

### Fixed
- sys.path pollution bug in run.py that made sibling directories accidentally importable
- Command preview now matches actual Metal execution environment

### Breaking Changes
- Root-level source files removed (single source restructure)
  - Edit files in `vllm_playground/` (not root)
  - Run with `python run.py` (unchanged)

---

## [v0.1.2](releases/v0.1.2.md) - 2026-01-19

**ModelScope Integration & i18n Improvements**

### Added
- 🌏 **ModelScope Support** - Alternative model source for China region users
  - ModelScope (魔搭社区) as model source option
  - Curated model list (Qwen, DeepSeek)
  - SDK detection and installation hints
  - Token configuration for private models
- 🌐 **i18n Chinese Translations** - Comprehensive Chinese language support
  - Response Metrics panel
  - GuideLLM Benchmark section
  - Server Configuration labels
  - Logs panel controls
- 💬 **Chat Improvements**
  - Export chat functionality
  - Clear chat confirmation modal

### Fixed
- 🐛 Windows Unicode decoding issue when reading HTML files
- 🐛 MCP nav icon display in collapsed sidebar
- 🐛 Nav badge visibility in collapsed state
- 🐛 Status dot layout affected by version text

---

## [v0.1.1](releases/v0.1.1.md) - 2026-01-08

**Agentic-Ready with MCP Support**

### Added
- 🔗 **MCP Integration** - Full Model Context Protocol support for agentic capabilities
  - MCP server management (add/edit/delete/connect/disconnect)
  - Tool execution with human-in-the-loop approval
  - Quick start presets (Filesystem, Git, Fetch, Time)
  - Auto-connect on startup option
- 🔍 **Runtime Detection** - Automatic detection of Podman, Docker, and vLLM
- 📌 **Version Display** - Version tag in sidebar footer

### Changed
- Container mode is now the default (better for new users)
- Improved help text with contextual information
- SVG icons replace emoji icons for Edit/Delete buttons
- Security notice moved to MCP Servers configuration

### Fixed
- MCP toolbar indicator not showing changes
- Tool execution targeting wrong tool call badge
- Graceful MCP server disconnect (anyio task group cleanup)
- App shutdown with connected MCP servers

---

## [v0.1.0](releases/v0.1.0.md) - 2026-01-02

**First Official Release**

### Added
- 💬 **Modern Chat UI** - ChatGPT-style interface with dark theme
- 🏗️ **Structured Outputs** - Choice, Regex, JSON Schema, Grammar modes
- 🔧 **Tool Calling** - Function calling with auto-detected parsers
- 🐳 **Container Mode** - Podman/Docker container orchestration
- 📊 **GuideLLM Benchmarking** - Performance testing integration
- 📚 **vLLM Recipes** - One-click community model configurations
- ☸️ **OpenShift/K8s** - Enterprise deployment support
- 📦 **PyPI Package** - `pip install vllm-playground`

### Features
- Subprocess and Container run modes
- Real-time streaming responses
- System prompt templates (8 presets)
- macOS Apple Silicon support
- Gated model support (HuggingFace tokens)

---

## Version History

| Version | Date | Highlights |
|---------|------|------------|
| v0.1.6 | 2026-03-02 | Observability dashboard, PagedAttention visualizer, token counter, logprobs, speculative decoding |
| v0.1.5 | 2026-02-08 | Remote server, VLM vision support, markdown rendering |
| v0.1.4 | 2026-02-01 | vLLM-Omni multimodal, Studio UI, pre-commit hooks |
| v0.1.3 | 2026-01-22 | Multi-accelerators, Claude Code, vLLM-Metal |
| v0.1.2 | 2026-01-19 | ModelScope integration, i18n improvements |
| v0.1.1 | 2026-01-08 | MCP integration, runtime detection |
| v0.1.0 | 2026-01-02 | First release, modern UI, tool calling |
