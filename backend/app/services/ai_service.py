from typing import List, Optional
from langchain.chat_models import ChatOpenAI
from langchain.schema import HumanMessage, AIMessage, SystemMessage
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


class AIService:
    def __init__(self):
        """Initialize AI service with OpenAI integration."""
        self.llm = ChatOpenAI(
            openai_api_key=settings.OPENAI_API_KEY,
            model_name=settings.OPENAI_MODEL,
            temperature=0.7,
        )
        
        self.system_prompt = """You are Second Self, an AI-powered personal assistant. 
        You are helpful, knowledgeable, and friendly. You provide clear and concise responses 
        while being conversational and engaging. You can help with a wide range of tasks 
        including answering questions, providing information, helping with analysis, 
        creative tasks, and general conversation."""
    
    async def generate_response(
        self, 
        user_message: str, 
        conversation_history: Optional[List[dict]] = None
    ) -> str:
        """Generate AI response to user message."""
        try:
            messages = [SystemMessage(content=self.system_prompt)]
            
            # Add conversation history if provided
            if conversation_history:
                for msg in conversation_history[-10:]:  # Keep last 10 messages for context
                    if msg["role"] == "user":
                        messages.append(HumanMessage(content=msg["content"]))
                    elif msg["role"] == "assistant":
                        messages.append(AIMessage(content=msg["content"]))
            
            # Add current user message
            messages.append(HumanMessage(content=user_message))
            
            # Generate response
            response = await self.llm.agenerate([messages])
            return response.generations[0][0].text
            
        except Exception as e:
            logger.error(f"AI service error: {str(e)}")
            return "I apologize, but I'm having trouble processing your request right now. Please try again."
    
    def get_conversation_title(self, first_message: str) -> str:
        """Generate a conversation title based on the first message."""
        try:
            # Simple title generation - you could make this more sophisticated
            words = first_message.split()[:5]
            title = " ".join(words)
            return title if len(title) <= 50 else title[:47] + "..."
        except Exception:
            return "New Conversation"