"""
chatbot/__init__.py — Krishi Mitra Chatbot Module
===================================================
Exposes the Flask blueprint so app.py can register it with one import.

Usage in app.py:
    from chatbot import chatbot_bp
    app.register_blueprint(chatbot_bp)
"""

from .routes import chatbot_bp  # noqa: F401

__all__ = ["chatbot_bp"]
