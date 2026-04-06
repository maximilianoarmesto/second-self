from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

# Import all models here to ensure they are registered with SQLAlchemy
from app.models.user import User  # noqa
from app.models.conversation import Conversation, Message  # noqa
from app.models.document import Document, DocumentChunk  # noqa