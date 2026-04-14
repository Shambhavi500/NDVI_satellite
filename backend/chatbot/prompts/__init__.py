"""
chatbot/prompts/__init__.py
============================
Re-exports the public prompt API for convenience.
"""

from .system_prompt import build_system_prompt  # noqa: F401

__all__ = ["build_system_prompt"]
