from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash, verify_password
from app.models.user import User
from app.schemas.user import UserCreate, User as UserSchema


class UserService:
    def __init__(self, db: AsyncSession) -> None:
        self.db = db

    async def get(self, user_id: int) -> Optional[UserSchema]:
        """Return the schema representation of a user by ID, or None."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        return UserSchema.model_validate(user) if user else None

    async def get_by_email(self, email: str) -> Optional[User]:
        """Return the raw ORM User row for *email*, or None."""
        result = await self.db.execute(select(User).where(User.email == email))
        return result.scalar_one_or_none()

    async def get_by_username(self, username: str) -> Optional[User]:
        """Return the raw ORM User row for *username*, or None."""
        result = await self.db.execute(select(User).where(User.username == username))
        return result.scalar_one_or_none()

    async def create(self, user_create: UserCreate) -> UserSchema:
        """Persist a new user and return the schema representation."""
        user = User(
            email=user_create.email,
            username=user_create.username,
            hashed_password=get_password_hash(user_create.password),
            full_name=user_create.full_name,
            is_active=user_create.is_active,
        )
        self.db.add(user)
        await self.db.commit()
        await self.db.refresh(user)
        return UserSchema.model_validate(user)

    async def authenticate(self, email: str, password: str) -> Optional[User]:
        """Return the ORM User if credentials are valid, else None."""
        user = await self.get_by_email(email)
        if not user:
            return None
        if not verify_password(password, user.hashed_password):
            return None
        return user
