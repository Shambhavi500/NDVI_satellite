"""
chatbot/config.py — Configuration Loader
==========================================
Reads chatbot/.env and exposes typed constants to the rest of the module.
Falls back to sensible defaults if a variable is not set.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load chatbot/.env (relative to THIS file's directory)
_env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=_env_path, override=False)


# ── Ollama ────────────────────────────────────────────────────────────────────
OLLAMA_BASE_URL: str  = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL: str     = os.getenv("OLLAMA_MODEL",    "llama3.2:1b")

OLLAMA_TEMPERATURE: float = float(os.getenv("OLLAMA_TEMPERATURE", "0.7"))
OLLAMA_MAX_TOKENS: int    = int(os.getenv("OLLAMA_MAX_TOKENS",    "512"))

# ── Session management ────────────────────────────────────────────────────────
CHATBOT_MAX_HISTORY: int = int(os.getenv("CHATBOT_MAX_HISTORY", "20"))

# ── Logging ───────────────────────────────────────────────────────────────────
CHATBOT_LOG_LEVEL: str = os.getenv("CHATBOT_LOG_LEVEL", "INFO")
