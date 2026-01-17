"""
MCP Server Configuration Models

Defines the configuration schema for MCP servers.
"""

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import json
from pathlib import Path
import logging

logger = logging.getLogger(__name__)


class MCPTransport(str, Enum):
    """Transport type for MCP server connection"""

    STDIO = "stdio"  # Local command execution (e.g., npx, python)
    SSE = "sse"  # Server-Sent Events over HTTP


class MCPServerConfig(BaseModel):
    """Configuration for an MCP server connection"""

    # Unique identifier for the server
    name: str = Field(..., description="Unique name for the MCP server")

    # Transport configuration
    transport: MCPTransport = Field(
        default=MCPTransport.STDIO,
        description="Transport type: stdio (local command) or sse (HTTP endpoint)",
    )

    # Stdio transport options
    command: Optional[str] = Field(
        default=None,
        description="Command to run for stdio transport (e.g., 'npx', 'python', 'node')",
    )
    args: Optional[List[str]] = Field(
        default=None,
        description="Arguments for the command (e.g., ['-y', '@mcp/server-filesystem', '/path'])",
    )

    # SSE transport options
    url: Optional[str] = Field(
        default=None, description="URL for SSE transport (e.g., 'http://localhost:8080/sse')"
    )

    # Environment variables
    env: Optional[Dict[str, str]] = Field(
        default=None, description="Environment variables to set when running the server"
    )

    # Connection settings
    enabled: bool = Field(default=True, description="Whether this server configuration is enabled")
    auto_connect: bool = Field(
        default=False, description="Automatically connect to this server on startup"
    )

    # Metadata
    description: Optional[str] = Field(
        default=None, description="Human-readable description of what this server provides"
    )

    class Config:
        use_enum_values = True


class MCPServerStatus(BaseModel):
    """Status of an MCP server connection"""

    name: str
    connected: bool = False
    error: Optional[str] = None
    tools_count: int = 0
    resources_count: int = 0
    prompts_count: int = 0


class MCPConfigStore:
    """
    Persistent storage for MCP server configurations.
    Stores configs in a JSON file in the user's config directory.
    """

    def __init__(self, config_path: Optional[Path] = None):
        if config_path is None:
            # Default to ~/.vllm-playground/mcp_servers.json
            config_dir = Path.home() / ".vllm-playground"
            config_dir.mkdir(parents=True, exist_ok=True)
            self.config_path = config_dir / "mcp_servers.json"
        else:
            self.config_path = Path(config_path)

        self._configs: Dict[str, MCPServerConfig] = {}
        self._load()

    def _load(self):
        """Load configurations from disk"""
        if self.config_path.exists():
            try:
                with open(self.config_path, "r") as f:
                    data = json.load(f)
                    for name, config_dict in data.get("servers", {}).items():
                        try:
                            self._configs[name] = MCPServerConfig(**config_dict)
                        except Exception as e:
                            logger.warning(f"Failed to load MCP config '{name}': {e}")
            except Exception as e:
                logger.warning(f"Failed to load MCP configs from {self.config_path}: {e}")

    def _save(self):
        """Save configurations to disk"""
        try:
            data = {
                "servers": {name: config.model_dump() for name, config in self._configs.items()}
            }
            with open(self.config_path, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save MCP configs to {self.config_path}: {e}")

    def list(self) -> List[MCPServerConfig]:
        """List all server configurations"""
        return list(self._configs.values())

    def get(self, name: str) -> Optional[MCPServerConfig]:
        """Get a server configuration by name"""
        return self._configs.get(name)

    def save(self, config: MCPServerConfig) -> None:
        """Save or update a server configuration"""
        self._configs[config.name] = config
        self._save()

    def delete(self, name: str) -> bool:
        """Delete a server configuration"""
        if name in self._configs:
            del self._configs[name]
            self._save()
            return True
        return False

    def exists(self, name: str) -> bool:
        """Check if a server configuration exists"""
        return name in self._configs


# Built-in presets for common MCP servers
# Reference: https://github.com/modelcontextprotocol/servers
MCP_PRESETS = [
    {
        "name": "filesystem",
        "display_name": "Filesystem",
        "description": "Secure file operations with configurable access controls",
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "${DIRECTORY}"],
        "env": {},
        "placeholder_vars": {
            "DIRECTORY": {
                "label": "Allowed Directory",
                "placeholder": "/home/user/documents",
                "required": True,
            }
        },
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem",
    },
    {
        "name": "git",
        "display_name": "Git",
        "description": "Tools to read, search, and manipulate Git repositories",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-git", "--repository", "${REPOSITORY}"],
        "env": {},
        "placeholder_vars": {
            "REPOSITORY": {
                "label": "Repository Path",
                "placeholder": "/path/to/git/repo",
                "required": True,
            }
        },
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/git",
    },
    {
        "name": "fetch",
        "display_name": "Fetch",
        "description": "Web content fetching and conversion for efficient LLM usage",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-fetch"],
        "env": {},
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/fetch",
    },
    {
        "name": "time",
        "display_name": "Time",
        "description": "Time and timezone conversion capabilities",
        "transport": "stdio",
        "command": "uvx",
        "args": ["mcp-server-time"],
        "env": {},
        "docs_url": "https://github.com/modelcontextprotocol/servers/tree/main/src/time",
    },
]
