from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.ai_service import AIService
from app.services.chat_service import ChatService
from datetime import datetime

router = APIRouter()


@router.post("/", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    """Process chat message and return AI response."""
    try:
        # Initialize services
        ai_service = AIService()
        chat_service = ChatService(db)
        
        # Get or create conversation
        conversation_id = request.conversation_id
        if not conversation_id:
            # For demo purposes, use user_id = 1 (you'd get this from auth)
            conversation_id = await chat_service.create_conversation(
                user_id=1,
                title="New Chat"
            )
        
        # Save user message
        await chat_service.save_message(
            conversation_id=conversation_id,
            content=request.message,
            role="user"
        )
        
        # Get AI response
        ai_response = await ai_service.generate_response(request.message)
        
        # Save AI response
        await chat_service.save_message(
            conversation_id=conversation_id,
            content=ai_response,
            role="assistant"
        )
        
        return ChatResponse(
            message=ai_response,
            conversation_id=conversation_id,
            created_at=datetime.utcnow()
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat processing failed: {str(e)}")


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get conversation by ID."""
    chat_service = ChatService(db)
    conversation = await chat_service.get_conversation(conversation_id)
    
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found")
    
    return conversation


@router.get("/conversations/")
async def list_conversations(
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """List user conversations."""
    chat_service = ChatService(db)
    # For demo purposes, use user_id = 1 (you'd get this from auth)
    conversations = await chat_service.get_user_conversations(
        user_id=1,
        skip=skip,
        limit=limit
    )
    
    return conversations