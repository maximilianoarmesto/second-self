"""
AIService — wraps LangChain / OpenAI to generate assistant responses.

The service is stateless; callers supply conversation history from the DB
(via ChatService.get_conversation_context) so context is always correct.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain.schema import AIMessage, HumanMessage, SystemMessage

from app.core.config import settings

logger = logging.getLogger(__name__)

_SYSTEM_PROMPT = (
    "You are Second Self, an AI-powered personal assistant. "
    "You are helpful, knowledgeable, and friendly. "
    "You provide clear and concise responses while being conversational and engaging. "
    "You can help with a wide range of tasks including answering questions, "
    "providing information, helping with analysis, creative tasks, and general conversation."
)

# Number of recent history messages fed to the model.  The current user turn
# is always appended on top of these.
_MAX_HISTORY = 10


class AIService:
    def __init__(self) -> None:
        """Initialise the LangChain ChatOpenAI wrapper."""
        self.llm = ChatOpenAI(
            openai_api_key=settings.OPENAI_API_KEY,
            model_name=settings.OPENAI_MODEL,
            temperature=0.7,
        )

    async def generate_response(
        self,
        user_message: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """
        Generate an assistant reply for *user_message*.

        Parameters
        ----------
        user_message:
            The latest message from the user.
        conversation_history:
            Ordered list of previous turns in the format returned by
            ``ChatService.get_conversation_context`` —
            ``[{"role": "user"|"assistant"|"system", "content": "..."}, ...]``.
            The most-recent *_MAX_HISTORY* entries are used.
        """
        try:
            messages: List = [SystemMessage(content=_SYSTEM_PROMPT)]

            if conversation_history:
                for turn in conversation_history[-_MAX_HISTORY:]:
                    role = turn.get("role", "user")
                    content = turn.get("content", "")
                    if role == "assistant":
                        messages.append(AIMessage(content=content))
                    elif role == "system":
                        messages.append(SystemMessage(content=content))
                    else:
                        messages.append(HumanMessage(content=content))

            messages.append(HumanMessage(content=user_message))

            response = await self.llm.agenerate([messages])
            return response.generations[0][0].text

        except Exception as exc:
            logger.error("AI service error: %s", exc, exc_info=True)
            return (
                "I apologise, but I'm having trouble processing your request right now. "
                "Please try again."
            )

    def get_conversation_title(self, first_message: str) -> str:
        """
        Derive a short conversation title from the first user message.

        Trims to the first five words and at most 50 characters.
        """
        try:
            words = first_message.split()[:5]
            title = " ".join(words)
            return title if len(title) <= 50 else title[:47] + "..."
        except Exception:
            return "New Conversation"
