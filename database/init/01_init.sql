-- Create database if it doesn't exist
-- This file is executed when the PostgreSQL container starts up

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Initial setup can be done here if needed
-- Tables will be created by Alembic migrations