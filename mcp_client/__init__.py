"""
MCP (Model Context Protocol) Integration for vLLM Playground

This module provides MCP client functionality to connect to MCP servers
and expose their tools to the LLM during chat sessions.

MCP is an optional dependency. Install with:
    pip install vllm-playground[mcp]

Or install mcp directly:
    pip install mcp
"""

from typing import TYPE_CHECKING

# Check if MCP is available
MCP_AVAILABLE = False
MCP_VERSION = None

try:
    import mcp

    MCP_AVAILABLE = True
    MCP_VERSION = getattr(mcp, "__version__", "unknown")
except ImportError:
    pass

# Only import manager if MCP is available
if TYPE_CHECKING or MCP_AVAILABLE:
    try:
        from .manager import MCPManager
        from .config import MCPServerConfig, MCPTransport
    except ImportError:
        MCPManager = None
        MCPServerConfig = None
        MCPTransport = None
else:
    MCPManager = None
    MCPServerConfig = None
    MCPTransport = None

__all__ = [
    "MCP_AVAILABLE",
    "MCP_VERSION",
    "MCPManager",
    "MCPServerConfig",
    "MCPTransport",
]
