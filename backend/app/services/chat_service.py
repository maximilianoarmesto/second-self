from typing import List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from app.models.conversation import Conversation, Message, MessageRole
from app.schemas.chat import Conversation as ConversationSchema
import logging

logger = logging.getLogger(__name__)


class ChatService:
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_conversation(self, user_id: int, title: str = "New Conversation") -> int:
        """Create a new conversation."""
        conversation = Conversation(
            user_id=user_id,
            title=title
        )
        self.db.add(conversation)
        await self.db.commit()
        await self.db.refresh(conversation)
        return conversation.id
    
    async def get_conversation(self, conversation_id: int) -> Optional[ConversationSchema]:
        """Get conversation by ID with messages."""
        query = (
            select(Conversation)
            .options(selectinload(Conversation.messages))
            .where(Conversation.id == conversation_id)
        )
        result = await self.db.execute(query)
        conversation = result.scalar_one_or_none()
        return ConversationSchema.from_orm(conversation) if conversation else None
    
    async def get_user_conversations(
        self, 
        user_id: int, 
        skip: int = 0, 
        limit: int = 20
    ) -> List[ConversationSchema]:
        """Get user conversations."""
        query = (
            select(Conversation)
            .where(Conversation.user_id == user_id)
            .order_by(Conversation.updated_at.desc())
            .offset(skip)
            .limit(limit)
        )
        result = await self.db.execute(query)
        conversations = result.scalars().all()
        return [ConversationSchema.from_orm(conv) for conv in conversations]
    
    async def save_message(
        self, 
        conversation_id: int, 
        content: str, 
        role: str
    ) -> int:
        """Save message to conversation."""
        message_role = MessageRole.USER if role == "user" else MessageRole.ASSISTANT
        
        message = Message(
            conversation_id=conversation_id,
            content=content,
            role=message_role
        )
        self.db.add(message)
        await self.db.commit()
        await self.db.refresh(message)
        
        # Update conversation's updated_at timestamp
        conversation_query = select(Conversation).where(Conversation.id == conversation_id)
        result = await self.db.execute(conversation_query)
        conversation = result.scalar_one_or_none()
        if conversation:
            await self.db.commit()  # This will trigger the updated_at update
        
        return message.id
    
    async def get_conversation_messages(
        self, 
        conversation_id: int, 
        limit: int = 50
    ) -> List[dict]:
        """Get conversation messages for AI context."""
        query = (
            select(Message)
            .where(Message.conversation_id == conversation_id)
            .order_by(Message.created_at.desc())
            .limit(limit)
        )
        result = await self.db.execute(query)
        messages = result.scalars().all()
        
        # Reverse to get chronological order and convert to dict
        return [
            {
                "content": msg.content,
                "role": msg.role.value,
                "created_at": msg.created_at
            }
            for msg in reversed(messages)
        ]