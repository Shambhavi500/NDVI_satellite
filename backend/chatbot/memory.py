"""
chatbot/memory.py — Session Memory Store
==========================================
Manages per-session conversation history in memory.

Design decisions:
  - Simple dict-based store (no Redis / DB needed for local dev)
  - Each session holds a list of {"role": "user"|"assistant", "content": "..."}
  - Oldest message pairs are trimmed when MAX_HISTORY is exceeded
  - Thread-safe for Flask's default threaded mode via a module-level lock
"""

from __future__ import annotations

import threading
from typing import Any
from .config import CHATBOT_MAX_HISTORY

# ── In-process session store ──────────────────────────────────────────────────
_sessions: dict[str, list[dict[str, str]]] = {}
_lock = threading.Lock()


def get_history(session_id: str) -> list[dict[str, str]]:
    """Return a copy of the message history for the given session."""
    with _lock:
        return list(_sessions.get(session_id, []))


def append_message(session_id: str, role: str, content: str) -> None:
    """
    Append a message to the session and trim old pairs if over the limit.
    Pairs are trimmed from the front (oldest first).
    """
    with _lock:
        history = _sessions.setdefault(session_id, [])
        history.append({"role": role, "content": content})

        # Trim oldest user+assistant pairs when over limit
        while len(history) > CHATBOT_MAX_HISTORY:
            history.pop(0)


def clear_session(session_id: str) -> None:
    """Delete all history for a session (reset conversation)."""
    with _lock:
        _sessions.pop(session_id, None)


def list_sessions() -> list[str]:
    """Return all active session IDs (for diagnostics)."""
    with _lock:
        return list(_sessions.keys())
