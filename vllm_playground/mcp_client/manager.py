"""
MCP Manager - Core orchestration for MCP server connections

This module manages connections to MCP servers and provides
a unified interface for tool discovery and execution.
"""

import asyncio
import logging
import shutil
from typing import Dict, List, Optional, Any, Set
from contextlib import asynccontextmanager

from .config import MCPServerConfig, MCPServerStatus, MCPTransport, MCPConfigStore, MCP_PRESETS

logger = logging.getLogger(__name__)

# Installation instructions for common MCP commands
COMMAND_INSTALL_HINTS = {
    "npx": {
        "check": "npx",
        "name": "Node.js/npm",
        "install": {
            "macos": "brew install node",
            "linux": "sudo apt install nodejs npm  # or: sudo dnf install nodejs npm",
            "windows": "Download from https://nodejs.org/",
            "generic": "Install Node.js from https://nodejs.org/",
        },
    },
    "uvx": {
        "check": "uvx",
        "name": "uv (Python package manager)",
        "install": {
            "macos": "brew install uv  # or: curl -LsSf https://astral.sh/uv/install.sh | sh",
            "linux": "curl -LsSf https://astral.sh/uv/install.sh | sh",
            "windows": 'powershell -c "irm https://astral.sh/uv/install.ps1 | iex"',
            "generic": "Install uv from https://docs.astral.sh/uv/",
        },
    },
    "node": {
        "check": "node",
        "name": "Node.js",
        "install": {"generic": "Install Node.js from https://nodejs.org/"},
    },
    "python": {
        "check": "python",
        "name": "Python",
        "install": {"generic": "Install Python from https://python.org/"},
    },
}


def check_command_available(command: str) -> tuple[bool, Optional[str]]:
    """
    Check if a command is available in the system PATH.
    Returns (is_available, error_message_if_not)
    """
    import platform

    # Get the base command (first word)
    base_command = command.split()[0] if command else ""

    if not base_command:
        return False, "No command specified"

    # Check if command exists
    if shutil.which(base_command):
        return True, None

    # Command not found - generate helpful error message
    system = platform.system().lower()
    if system == "darwin":
        system = "macos"

    hint = COMMAND_INSTALL_HINTS.get(base_command)
    if hint:
        install_cmd = hint["install"].get(system, hint["install"].get("generic", ""))
        error_msg = (
            f"Command '{base_command}' not found. "
            f"{hint['name']} is required.\n\n"
            f"To install:\n{install_cmd}"
        )
    else:
        error_msg = (
            f"Command '{base_command}' not found. Please install it and ensure it's in your PATH."
        )

    return False, error_msg


# Check MCP availability
try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    from mcp.client.sse import sse_client

    MCP_AVAILABLE = True
except ImportError:
    MCP_AVAILABLE = False
    ClientSession = None
    StdioServerParameters = None
    stdio_client = None
    sse_client = None


class MCPServerConnection:
    """Represents an active connection to an MCP server"""

    def __init__(self, config: MCPServerConfig):
        self.config = config
        self.session: Optional[Any] = None  # ClientSession when connected
        self._client_context = None
        self._session_context = None
        self._read = None
        self._write = None
        self.connected = False
        self.error: Optional[str] = None
        self.tools: List[Dict] = []
        self.resources: List[Dict] = []
        self.prompts: List[Dict] = []

    async def connect(self) -> bool:
        """Establish connection to the MCP server"""
        if not MCP_AVAILABLE:
            self.error = "MCP package not installed. Run: pip install mcp"
            return False

        try:
            if self.config.transport == MCPTransport.STDIO:
                return await self._connect_stdio()
            elif self.config.transport == MCPTransport.SSE:
                return await self._connect_sse()
            else:
                self.error = f"Unknown transport type: {self.config.transport}"
                return False
        except Exception as e:
            self.error = str(e)
            logger.error(f"Failed to connect to MCP server '{self.config.name}': {e}")
            return False

    async def _connect_stdio(self) -> bool:
        """Connect via stdio transport"""
        if not self.config.command:
            self.error = "No command specified for stdio transport"
            return False

        # Check if the command is available before attempting to connect
        is_available, error_msg = check_command_available(self.config.command)
        if not is_available:
            self.error = error_msg
            logger.error(f"MCP server '{self.config.name}': {error_msg}")
            return False

        try:
            # Build server parameters
            server_params = StdioServerParameters(
                command=self.config.command, args=self.config.args or [], env=self.config.env
            )

            # Create the client context
            self._client_context = stdio_client(server_params)
            self._read, self._write = await self._client_context.__aenter__()

            # Create the session
            self._session_context = ClientSession(self._read, self._write)
            self.session = await self._session_context.__aenter__()

            # Initialize the session
            await self.session.initialize()

            # Fetch available tools, resources, and prompts
            await self._fetch_capabilities()

            self.connected = True
            self.error = None
            logger.info(f"Connected to MCP server '{self.config.name}' via stdio")
            return True

        except Exception as e:
            self.error = str(e)
            logger.error(f"Stdio connection failed for '{self.config.name}': {e}")
            await self._cleanup()
            return False

    async def _connect_sse(self) -> bool:
        """Connect via SSE transport"""
        if not self.config.url:
            self.error = "No URL specified for SSE transport"
            return False

        try:
            # Create the client context
            self._client_context = sse_client(self.config.url)
            self._read, self._write = await self._client_context.__aenter__()

            # Create the session
            self._session_context = ClientSession(self._read, self._write)
            self.session = await self._session_context.__aenter__()

            # Initialize the session
            await self.session.initialize()

            # Fetch available tools, resources, and prompts
            await self._fetch_capabilities()

            self.connected = True
            self.error = None
            logger.info(f"Connected to MCP server '{self.config.name}' via SSE")
            return True

        except Exception as e:
            self.error = str(e)
            logger.error(f"SSE connection failed for '{self.config.name}': {e}")
            await self._cleanup()
            return False

    async def _fetch_capabilities(self):
        """Fetch tools, resources, and prompts from the server"""
        if not self.session:
            return

        try:
            # Fetch tools
            tools_result = await self.session.list_tools()
            self.tools = [
                {
                    "name": tool.name,
                    "description": tool.description,
                    "inputSchema": tool.inputSchema if hasattr(tool, "inputSchema") else {},
                }
                for tool in tools_result.tools
            ]
            logger.info(f"Server '{self.config.name}' has {len(self.tools)} tools")
        except Exception as e:
            logger.warning(f"Failed to fetch tools from '{self.config.name}': {e}")
            self.tools = []

        try:
            # Fetch resources
            resources_result = await self.session.list_resources()
            self.resources = [
                {
                    "uri": res.uri,
                    "name": res.name,
                    "description": getattr(res, "description", None),
                    "mimeType": getattr(res, "mimeType", None),
                }
                for res in resources_result.resources
            ]
            logger.info(f"Server '{self.config.name}' has {len(self.resources)} resources")
        except Exception as e:
            logger.debug(f"Failed to fetch resources from '{self.config.name}': {e}")
            self.resources = []

        try:
            # Fetch prompts
            prompts_result = await self.session.list_prompts()
            self.prompts = [
                {
                    "name": prompt.name,
                    "description": getattr(prompt, "description", None),
                    "arguments": getattr(prompt, "arguments", []),
                }
                for prompt in prompts_result.prompts
            ]
            logger.info(f"Server '{self.config.name}' has {len(self.prompts)} prompts")
        except Exception as e:
            logger.debug(f"Failed to fetch prompts from '{self.config.name}': {e}")
            self.prompts = []

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool on the MCP server"""
        if not self.connected or not self.session:
            raise RuntimeError(f"Not connected to MCP server '{self.config.name}'")

        try:
            result = await self.session.call_tool(name, arguments)
            return result
        except Exception as e:
            logger.error(f"Tool call '{name}' failed on '{self.config.name}': {e}")
            raise

    async def disconnect(self):
        """Disconnect from the MCP server"""
        await self._cleanup()
        self.connected = False
        logger.info(f"Disconnected from MCP server '{self.config.name}'")

    async def _cleanup(self):
        """
        Clean up connection resources.

        Note: The MCP client uses anyio task groups which require exit from
        the same task that entered. We handle this by:
        1. Closing streams to signal the subprocess
        2. Explicitly closing async generators to prevent GC-triggered errors
        3. Suppressing the inevitable cancel scope errors
        """
        import asyncio

        # Try to close the write stream to signal the server to exit
        if self._write:
            try:
                if hasattr(self._write, "aclose"):
                    await self._write.aclose()
            except Exception:
                pass

        # Try to close the read stream
        if self._read:
            try:
                if hasattr(self._read, "aclose"):
                    await self._read.aclose()
            except Exception:
                pass

        # Try to explicitly close async generator contexts to prevent
        # the "Task exception was never retrieved" error during GC.
        # This will still raise the cancel scope error, but we catch it here
        # instead of letting it bubble up through asyncio's error handler.
        for ctx in [self._session_context, self._client_context]:
            if ctx is not None:
                try:
                    # If it's an async generator, close it
                    if hasattr(ctx, "aclose"):
                        await ctx.aclose()
                    elif hasattr(ctx, "__aexit__"):
                        # Suppress errors from __aexit__
                        try:
                            await ctx.__aexit__(None, None, None)
                        except RuntimeError:
                            # Expected: "Attempted to exit cancel scope in a different task"
                            pass
                except (RuntimeError, GeneratorExit, Exception):
                    # Suppress all cleanup errors - the important thing is
                    # that we've signaled the subprocess to exit
                    pass

        # Clear all references
        self.session = None
        self._session_context = None
        self._client_context = None
        self._read = None
        self._write = None

    def get_status(self) -> MCPServerStatus:
        """Get the current status of this connection"""
        return MCPServerStatus(
            name=self.config.name,
            connected=self.connected,
            error=self.error,
            tools_count=len(self.tools),
            resources_count=len(self.resources),
            prompts_count=len(self.prompts),
        )


class MCPManager:
    """
    Central manager for MCP server connections.

    Handles:
    - Server configuration persistence
    - Connection lifecycle management
    - Tool discovery and aggregation
    - Tool execution routing
    """

    def __init__(self, config_store: Optional[MCPConfigStore] = None):
        self.config_store = config_store or MCPConfigStore()
        self.connections: Dict[str, MCPServerConnection] = {}
        self._tool_server_map: Dict[str, str] = {}  # tool_name -> server_name

    @property
    def is_available(self) -> bool:
        """Check if MCP is available"""
        return MCP_AVAILABLE

    # === Configuration Management ===

    def list_configs(self) -> List[MCPServerConfig]:
        """List all server configurations"""
        return self.config_store.list()

    def get_config(self, name: str) -> Optional[MCPServerConfig]:
        """Get a server configuration by name"""
        return self.config_store.get(name)

    def save_config(self, config: MCPServerConfig) -> None:
        """Save or update a server configuration"""
        self.config_store.save(config)

    def delete_config(self, name: str) -> bool:
        """Delete a server configuration (also disconnects if connected)"""
        if name in self.connections:
            asyncio.create_task(self.disconnect(name))
        return self.config_store.delete(name)

    def get_presets(self) -> List[Dict]:
        """Get built-in MCP server presets"""
        return MCP_PRESETS

    # === Connection Management ===

    async def connect(self, name: str) -> bool:
        """Connect to an MCP server by name"""
        config = self.config_store.get(name)
        if not config:
            logger.error(f"No configuration found for MCP server '{name}'")
            return False

        if not config.enabled:
            logger.warning(f"MCP server '{name}' is disabled")
            return False

        # Disconnect existing connection if any
        if name in self.connections:
            await self.disconnect(name)

        # Create and establish connection
        connection = MCPServerConnection(config)
        success = await connection.connect()

        if success:
            self.connections[name] = connection
            self._update_tool_map()

        return success

    async def disconnect(self, name: str) -> bool:
        """Disconnect from an MCP server"""
        if name not in self.connections:
            return False

        connection = self.connections[name]
        await connection.disconnect()
        del self.connections[name]
        self._update_tool_map()
        return True

    async def disconnect_all(self):
        """Disconnect from all MCP servers"""
        for name in list(self.connections.keys()):
            await self.disconnect(name)

    async def auto_connect(self):
        """Connect to all servers with auto_connect enabled"""
        for config in self.config_store.list():
            if config.auto_connect and config.enabled:
                await self.connect(config.name)

    def get_status(self, name: Optional[str] = None) -> List[MCPServerStatus]:
        """Get status of MCP servers"""
        if name:
            if name in self.connections:
                return [self.connections[name].get_status()]
            config = self.config_store.get(name)
            if config:
                return [MCPServerStatus(name=name, connected=False)]
            return []

        # Return status for all configured servers
        statuses = []
        for config in self.config_store.list():
            if config.name in self.connections:
                statuses.append(self.connections[config.name].get_status())
            else:
                statuses.append(MCPServerStatus(name=config.name, connected=False))
        return statuses

    # === Tool Management ===

    def _update_tool_map(self):
        """Update the tool-to-server mapping"""
        self._tool_server_map.clear()
        for name, connection in self.connections.items():
            if connection.connected:
                for tool in connection.tools:
                    tool_name = tool["name"]
                    if tool_name in self._tool_server_map:
                        logger.warning(
                            f"Tool '{tool_name}' exists in multiple servers. "
                            f"Using server '{self._tool_server_map[tool_name]}'"
                        )
                    else:
                        self._tool_server_map[tool_name] = name

    def get_tools(self, server_names: Optional[List[str]] = None) -> List[Dict]:
        """
        Get tools from connected servers in OpenAI function calling format.

        Args:
            server_names: Optional list of server names to get tools from.
                         If None, returns tools from all connected servers.
        """
        tools = []
        servers_to_check = server_names if server_names else list(self.connections.keys())

        for name in servers_to_check:
            if name not in self.connections:
                continue
            connection = self.connections[name]
            if not connection.connected:
                continue

            for tool in connection.tools:
                # Convert MCP tool to OpenAI function format
                openai_tool = {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get(
                            "inputSchema", {"type": "object", "properties": {}, "required": []}
                        ),
                    },
                    # Add metadata for routing
                    "_mcp_server": name,
                }
                tools.append(openai_tool)

        return tools

    def is_mcp_tool(self, tool_name: str) -> bool:
        """Check if a tool is from an MCP server"""
        return tool_name in self._tool_server_map

    def get_tool_server(self, tool_name: str) -> Optional[str]:
        """Get the server name for a tool"""
        return self._tool_server_map.get(tool_name)

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """
        Execute a tool call on the appropriate MCP server.

        Args:
            tool_name: Name of the tool to call
            arguments: Arguments to pass to the tool

        Returns:
            The result from the tool execution
        """
        server_name = self._tool_server_map.get(tool_name)
        if not server_name:
            raise ValueError(f"Unknown MCP tool: {tool_name}")

        connection = self.connections.get(server_name)
        if not connection or not connection.connected:
            raise RuntimeError(f"MCP server '{server_name}' is not connected")

        result = await connection.call_tool(tool_name, arguments)

        # Format result for LLM consumption
        if hasattr(result, "content"):
            # Handle MCP result format
            content_parts = []
            for item in result.content:
                if hasattr(item, "text"):
                    content_parts.append(item.text)
                elif hasattr(item, "data"):
                    content_parts.append(str(item.data))
                else:
                    content_parts.append(str(item))
            return "\n".join(content_parts)

        return str(result)


# Global manager instance (created lazily)
_mcp_manager: Optional[MCPManager] = None


def get_mcp_manager() -> MCPManager:
    """Get the global MCP manager instance"""
    global _mcp_manager
    if _mcp_manager is None:
        _mcp_manager = MCPManager()
    return _mcp_manager
