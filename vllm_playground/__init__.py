"""
vLLM Playground - A web interface for managing and interacting with vLLM
"""

__version__ = "0.1.3rc1"
__author__ = "micytao"
__description__ = "A web interface for managing and interacting with vLLM servers"

from pathlib import Path

# Package root directory (where this __init__.py lives)
PACKAGE_DIR = Path(__file__).parent

# Expose main function for programmatic use
def run(host: str = "0.0.0.0", port: int = 7860, reload: bool = False):
    """
    Run the vLLM Playground web server.
    
    Args:
        host: Host to bind to (default: 0.0.0.0)
        port: Port to listen on (default: 7860)
        reload: Enable auto-reload for development (default: False)
    """
    from .app import main as _main
    _main(host=host, port=port, reload=reload)

__all__ = ["run", "__version__", "PACKAGE_DIR"]

