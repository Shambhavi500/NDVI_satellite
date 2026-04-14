"""
chatbot/chain.py — LangChain + Ollama Chain Factory
======================================================
Encapsulates all LangChain setup: model, prompt template, and invocation.
Nothing in this file knows about Flask, HTTP, or the farm data schema —
those are concerns of routes.py and prompts/system_prompt.py respectively.

Architecture
------------
We use the modern LangChain v0.3 Expression Language (LCEL) pipeline:

    prompt | llm

instead of the deprecated ConversationChain class, which gives us:
  - Streaming-ready output
  - Clean type signatures
  - No internal state (stateless chain — history passed per call)
"""

from __future__ import annotations

import logging
from typing import Any

from langchain_ollama import ChatOllama
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from langchain_core.output_parsers import StrOutputParser

from .config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TEMPERATURE,
    OLLAMA_MAX_TOKENS,
)

logger = logging.getLogger("chatbot.chain")


# ─────────────────────────────────────────────────────────────────────────────
# LLM singleton — one instance for the lifetime of the process
# ─────────────────────────────────────────────────────────────────────────────

_llm: ChatOllama | None = None


def _get_llm() -> ChatOllama:
    """Lazy-initialise and return the shared ChatOllama instance."""
    global _llm
    if _llm is None:
        logger.info(
            "Initialising ChatOllama — model=%s base_url=%s",
            OLLAMA_MODEL,
            OLLAMA_BASE_URL,
        )
        _llm = ChatOllama(
            model=OLLAMA_MODEL,
            base_url=OLLAMA_BASE_URL,
            temperature=OLLAMA_TEMPERATURE,
            num_predict=OLLAMA_MAX_TOKENS,
        )
    return _llm


# ─────────────────────────────────────────────────────────────────────────────
# Chain builder (stateless — history injected at call time)
# ─────────────────────────────────────────────────────────────────────────────

def build_chain(system_prompt: str):
    """
    Return an LCEL chain: prompt | llm | parser

    The chain expects this input dict:
        {
            "history": [HumanMessage(...), AIMessage(...), ...],
            "input":   "user's current message"
        }

    Returns a plain string (the assistant's reply).
    """
    prompt = ChatPromptTemplate.from_messages([
        ("system", system_prompt),
        MessagesPlaceholder(variable_name="history"),
        ("human", "{input}"),
    ])

    chain = prompt | _get_llm() | StrOutputParser()
    return chain


# ─────────────────────────────────────────────────────────────────────────────
# Helpers: convert raw history dicts ↔ LangChain message objects
# ─────────────────────────────────────────────────────────────────────────────

def history_to_messages(history: list[dict[str, str]]) -> list:
    """
    Convert [{"role": "user"|"assistant", "content": "..."}, ...]
    into LangChain message objects for injecting into the prompt.
    """
    messages = []
    for msg in history:
        role    = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            messages.append(HumanMessage(content=content))
        elif role == "assistant":
            messages.append(AIMessage(content=content))
    return messages


# ─────────────────────────────────────────────────────────────────────────────
# Main invocation helper
# ─────────────────────────────────────────────────────────────────────────────

def invoke_chain(
    system_prompt: str,
    history: list[dict[str, str]],
    user_input: str,
) -> str:
    """
    Build a chain, inject history, run it, and return the reply string.

    Parameters
    ----------
    system_prompt : str
        Full rendered system prompt from prompts/system_prompt.py.
    history : list[dict]
        Past messages [{"role": ..., "content": ...}, ...] (EXCLUDING current turn).
    user_input : str
        The user's latest message.

    Returns
    -------
    str
        The assistant's reply.

    Raises
    ------
    RuntimeError
        If Ollama is unreachable or returns an empty response.
    """
    chain = build_chain(system_prompt)
    lc_history = history_to_messages(history)

    try:
        reply: str = chain.invoke({
            "history": lc_history,
            "input":   user_input,
        })
    except Exception as exc:
        logger.error("Ollama invocation failed: %s", exc, exc_info=True)
        raise RuntimeError(
            "Could not connect to the farm analysis engine. "
            "Please make sure the local AI service is running."
        ) from exc

    if not reply or not reply.strip():
        raise RuntimeError("I could not process that. Please try asking again.")

    return reply.strip()
