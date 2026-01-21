# Architecture Overview

vLLM Playground uses a **hybrid architecture** that works seamlessly in both local and cloud environments.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Web UI (FastAPI)                        │
│              app.py + index.html + static/                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ├─→ container_manager.py (Local)
                         │   └─→ Podman CLI
                         │       └─→ vLLM Container
                         │
                         └─→ kubernetes_container_manager.py (Cloud)
                             └─→ Kubernetes API
                                 └─→ vLLM Pods
```

---

## Local Development (Container Orchestration)

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ http://localhost:7860
         ↓
┌──────────────────┐
│   Web UI (Host)  │  ← FastAPI app
│   app.py         │
└────────┬─────────┘
         │ Podman CLI
         ↓
┌──────────────────┐
│ container_manager│  ← Podman orchestration
│     .py          │
└────────┬─────────┘
         │ podman run/stop
         ↓
┌──────────────────┐
│  vLLM Container  │  ← Isolated vLLM service
│  (Port 8000)     │
└──────────────────┘
```

### Key Components

| Component | File | Description |
|-----------|------|-------------|
| Backend | `app.py` | FastAPI application |
| Container Manager | `container_manager.py` | Podman orchestration |
| Frontend | `static/js/app.js` | Vanilla JavaScript |
| Styling | `static/css/style.css` | Custom CSS |
| MCP Client | `mcp_client/` | Model Context Protocol integration |

---

## OpenShift/Kubernetes Deployment

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ https://route-url
         ↓
┌──────────────────┐
│ OpenShift Route  │
└────────┬─────────┘
         ↓
┌──────────────────┐
│  Web UI Pod      │  ← FastAPI app in container
│  (Deployment)    │  ← Auto-detects GPU availability
└────────┬─────────┘
         │ Kubernetes API
         │ (reads nodes, creates/deletes pods)
         ↓
┌──────────────────┐
│   kubernetes_    │  ← K8s API orchestration
│   container_     │  ← Checks nvidia.com/gpu resources
│   manager.py     │
└────────┬─────────┘
         │ create/delete pods
         ↓
┌──────────────────┐
│  vLLM Pod        │  ← Dynamically created
│  (Dynamic)       │  ← GPU: Official vLLM image
│                  │  ← CPU: Self-built optimized image
└──────────────────┘
```

### Container Images

| Mode | Image | Notes |
|------|-------|-------|
| GPU | `vllm/vllm-openai:v0.12.0` | Official vLLM image (v0.12.0+ for Claude Code) |
| CPU (Linux x86) | `quay.io/rh_ee_micyang/vllm-cpu:v0.11.0` | Self-built |
| CPU (macOS ARM64) | `quay.io/rh_ee_micyang/vllm-mac:v0.11.0` | Self-built |

---

## MCP (Model Context Protocol) Architecture

```
┌──────────────────┐
│   User Browser   │
└────────┬─────────┘
         │ Chat with tool calls
         ↓
┌──────────────────┐
│   Web UI         │  ← Manages MCP connections
│   (FastAPI)      │  ← Routes tool calls
└────────┬─────────┘
         │
    ┌────┴────┐
    ↓         ↓
┌────────┐ ┌────────┐
│  MCP   │ │  MCP   │  ← External MCP Servers
│Server 1│ │Server 2│  ← (filesystem, git, fetch, etc.)
└────────┘ └────────┘
```

### MCP Components

| Component | Location | Description |
|-----------|----------|-------------|
| MCP Manager | `mcp_client/manager.py` | Connection management |
| MCP Config | `mcp_client/config.py` | Server configurations |
| User Config | `~/.vllm-playground/mcp_servers.json` | Persisted settings |

---

## Request Flow

### Chat Request (without MCP)

```
User → Browser → FastAPI → vLLM Container → Response → Browser → User
```

### Chat Request (with MCP Tool Calls)

```
User → Browser → FastAPI → vLLM Container
                              ↓
                         Tool Call Response
                              ↓
                    User Approves Execution
                              ↓
                    FastAPI → MCP Server
                              ↓
                         Tool Result
                              ↓
                    FastAPI → vLLM Container
                              ↓
                      Final Response → User
```

---

## Project Structure

```
vllm-playground/
├── app.py                       # Main FastAPI backend
├── run.py                       # Backend server launcher
├── container_manager.py         # Podman container orchestration
├── index.html                   # Main HTML interface
├── pyproject.toml               # PyPI package configuration
├── requirements.txt             # Python dependencies
│
├── vllm_playground/             # PyPI package source
│   ├── __init__.py              # Package version
│   ├── app.py                   # FastAPI application
│   ├── cli.py                   # CLI entry point
│   └── ...                      # Static assets
│
├── mcp_client/                  # MCP integration
│   ├── config.py                # Server configurations
│   └── manager.py               # Connection management
│
├── static/                      # Frontend assets
│   ├── css/style.css            # Main stylesheet
│   └── js/app.js                # Frontend JavaScript
│
├── containers/                  # Container definitions
│   ├── Containerfile.vllm-playground
│   └── Containerfile.mac
│
├── openshift/                   # OpenShift/K8s deployment
│   ├── kubernetes_container_manager.py
│   ├── manifests/               # K8s manifests
│   └── deploy.sh                # Deployment script
│
├── recipes/                     # vLLM Community Recipes
│   └── recipes_catalog.json
│
├── config/                      # Configuration files
│   └── vllm_cpu.env
│
├── scripts/                     # Utility scripts
│   ├── run_cpu.sh
│   └── sync_to_package.py
│
├── docs/                        # Documentation
│   ├── INSTALLATION.md
│   ├── ARCHITECTURE.md
│   ├── TROUBLESHOOTING.md
│   └── ...
│
├── releases/                    # Release notes
│   ├── v0.1.1.md
│   └── v0.1.0.md
│
├── CHANGELOG.md                 # Version history
│
└── assets/                      # Images and screenshots
```

---

## Key Features by Component

### Backend (FastAPI)
- Server lifecycle management
- Streaming chat responses
- GuideLLM benchmarking integration
- MCP server management

### Frontend (JavaScript)
- Modern chat interface
- Real-time streaming display
- Tool calling UI with approval flow
- Structured outputs configuration

### Container Manager
- Automatic container lifecycle
- Smart configuration caching
- Health checking
- Log streaming

### MCP Client
- Multiple server connections
- Human-in-the-loop tool execution
- Per-tool enable/disable
- Auto-connect on startup

---

## Development Notes

### Running in Development

```bash
# Start backend with auto-reload
uvicorn app:app --reload --port 7860

# Or use the run script
python run.py
```

### Building Containers

```bash
# Build vLLM service container (macOS/CPU ARM64)
podman build -f containers/Containerfile.mac -t vllm-mac:v0.11.0 .

# Build Web UI orchestrator container
podman build -f containers/Containerfile.vllm-playground -t vllm-playground:latest .

# Build OpenShift Web UI container
podman build -f openshift/Containerfile -t vllm-playground-webui:latest .
```

### Syncing to Package

After modifying source files:

```bash
python scripts/sync_to_package.py
```

This syncs files from the root to `vllm_playground/` for PyPI packaging.
