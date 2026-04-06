"""
Unit tests for AIService.

The LangChain ChatOpenAI client is mocked — no real API calls are made.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.ai_service import AIService, _MAX_HISTORY, _SYSTEM_PROMPT

pytestmark = pytest.mark.unit


def _make_service_with_mock(reply_text: str = "AI says hello") -> tuple[AIService, MagicMock]:
    """Return an AIService whose LLM is a mock that returns *reply_text*."""
    service = AIService.__new__(AIService)

    generation = MagicMock()
    generation.text = reply_text

    mock_llm = MagicMock()
    mock_llm.agenerate = AsyncMock(
        return_value=MagicMock(generations=[[generation]])
    )
    service.llm = mock_llm
    return service, mock_llm


@pytest.mark.asyncio
async def test_generate_response_no_history() -> None:
    service, mock_llm = _make_service_with_mock("Hello!")

    result = await service.generate_response("Hi there")

    assert result == "Hello!"
    mock_llm.agenerate.assert_awaited_once()
    # The call should include just system + user message
    call_args = mock_llm.agenerate.call_args[0][0]  # first positional arg = message list
    messages = call_args[0]
    assert messages[0].content == _SYSTEM_PROMPT


@pytest.mark.asyncio
async def test_generate_response_with_history() -> None:
    service, mock_llm = _make_service_with_mock("Response with context")

    history = [
        {"role": "user", "content": "Previous question"},
        {"role": "assistant", "content": "Previous answer"},
    ]

    result = await service.generate_response("New question", conversation_history=history)

    assert result == "Response with context"

    messages_sent = mock_llm.agenerate.call_args[0][0][0]
    # system + 2 history + current user = 4
    assert len(messages_sent) == 4


@pytest.mark.asyncio
async def test_generate_response_caps_history() -> None:
    """Only the last _MAX_HISTORY entries from conversation_history are used."""
    service, mock_llm = _make_service_with_mock("Capped")

    # Build more history than the cap
    history = [
        {"role": "user" if i % 2 == 0 else "assistant", "content": f"msg {i}"}
        for i in range(_MAX_HISTORY + 10)
    ]

    await service.generate_response("Current", conversation_history=history)

    messages_sent = mock_llm.agenerate.call_args[0][0][0]
    # system + _MAX_HISTORY history entries + current user message
    assert len(messages_sent) == 1 + _MAX_HISTORY + 1


@pytest.mark.asyncio
async def test_generate_response_handles_exception_gracefully() -> None:
    service = AIService.__new__(AIService)
    mock_llm = MagicMock()
    mock_llm.agenerate = AsyncMock(side_effect=RuntimeError("API down"))
    service.llm = mock_llm

    result = await service.generate_response("Will this fail?")

    assert "trouble" in result.lower()


def test_get_conversation_title_short_message() -> None:
    service = AIService.__new__(AIService)
    service.llm = MagicMock()

    title = service.get_conversation_title("Hello world")
    assert title == "Hello world"


def test_get_conversation_title_long_message() -> None:
    service = AIService.__new__(AIService)
    service.llm = MagicMock()

    long_msg = "word " * 20  # 20 words
    title = service.get_conversation_title(long_msg)
    assert len(title) <= 50


def test_get_conversation_title_empty() -> None:
    service = AIService.__new__(AIService)
    service.llm = MagicMock()

    title = service.get_conversation_title("")
    # Should not raise; returns empty string or fallback
    assert isinstance(title, str)
