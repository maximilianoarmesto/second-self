from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from app.db.database import get_db
from app.schemas.user import User, UserCreate
from app.services.user_service import UserService

router = APIRouter()


@router.post("/", response_model=User, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_in: UserCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create new user."""
    user_service = UserService(db)
    
    # Check if user already exists
    existing_user = await user_service.get_by_email(user_in.email)
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="User with this email already exists"
        )
    
    existing_user = await user_service.get_by_username(user_in.username)
    if existing_user:
        raise HTTPException(
            status_code=400,
            detail="User with this username already exists"
        )
    
    user = await user_service.create(user_in)
    return user


@router.get("/me", response_model=User)
async def read_user_me(
    db: AsyncSession = Depends(get_db)
):
    """Get current user info."""
    # This is a placeholder - you'd get the current user from auth
    user_service = UserService(db)
    user = await user_service.get(1)  # Demo: get user with ID 1
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user


@router.get("/{user_id}", response_model=User)
async def read_user(
    user_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get user by ID."""
    user_service = UserService(db)
    user = await user_service.get(user_id)
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    return user