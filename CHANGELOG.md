# Changelog

All notable changes to vLLM Playground are documented here.

For detailed release notes, see the [releases/](releases/) folder.

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
| v0.1.2 | 2026-01-19 | ModelScope integration, i18n improvements |
| v0.1.1 | 2026-01-08 | MCP integration, runtime detection |
| v0.1.0 | 2026-01-02 | First release, modern UI, tool calling |
