"""
User Settings Store

Persistent storage for user preferences in ~/.vllm-playground/settings.json.
Follows the same pattern as MCPConfigStore for MCP server configurations.
"""

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Default settings returned when no settings file exists or on corruption.
# These must be kept in sync with the frontend fallback defaults in app.js.
DEFAULTS: Dict[str, Any] = {
    "theme": "dark",
    "locale": "en",
    "layout": None,  # None = let CSS handle initial panel sizes
    "vllm_run_mode": "remote",
    "vllm_remote_url": "",
    "vllm_remote_api_key": "",
    "omni_run_mode": "remote",
    "omni_remote_url": "",
    "omni_remote_api_key": "",
}

# Keys that are allowed to be stored (acts as a simple schema guard)
ALLOWED_KEYS = set(DEFAULTS.keys())


class SettingsStore:
    """
    Persistent storage for user settings in ~/.vllm-playground/settings.json.

    - get()    -> returns all settings (merged with defaults)
    - update() -> merges partial updates, saves, and returns full settings
    """

    def __init__(self, config_path: Optional[Path] = None):
        if config_path is None:
            config_dir = Path.home() / ".vllm-playground"
            config_dir.mkdir(parents=True, exist_ok=True)
            self.config_path = config_dir / "settings.json"
        else:
            self.config_path = Path(config_path)

        self._settings: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        """Load settings from disk. Handle missing / corrupted files gracefully."""
        if not self.config_path.exists():
            return  # No file yet – get() will return defaults

        try:
            with open(self.config_path, "r") as f:
                data = json.load(f)
            if isinstance(data, dict):
                # Only keep known keys
                self._settings = {k: v for k, v in data.items() if k in ALLOWED_KEYS}
            else:
                logger.warning(f"settings.json has unexpected format, ignoring")
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Corrupted settings.json, resetting to defaults: {e}")
            # Back up the corrupted file so the user can inspect it
            backup_path = self.config_path.with_suffix(".json.bak")
            try:
                shutil.copy2(self.config_path, backup_path)
                logger.info(f"Backed up corrupted settings to {backup_path}")
            except Exception as backup_err:
                logger.warning(f"Could not back up corrupted settings: {backup_err}")
        except Exception as e:
            logger.warning(f"Failed to load settings from {self.config_path}: {e}")

    def _save(self) -> None:
        """Save current settings to disk."""
        try:
            # Ensure parent directory exists
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.config_path, "w") as f:
                json.dump(self._settings, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save settings to {self.config_path}: {e}")

    def get(self) -> Dict[str, Any]:
        """Return all settings, filling in defaults for any missing keys."""
        merged = dict(DEFAULTS)
        merged.update(self._settings)
        return merged

    def update(self, updates: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merge *updates* into stored settings, save to disk, and return
        the full (merged-with-defaults) settings dict.

        Unknown keys are silently ignored.
        """
        for key, value in updates.items():
            if key in ALLOWED_KEYS:
                self._settings[key] = value
        self._save()
        return self.get()
