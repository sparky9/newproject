-- Initialize database extensions for Online C Suite
-- This file runs automatically when the Docker container is first created

-- Enable pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgcrypto for additional encryption functions (if needed)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Log successful initialization
DO $$
BEGIN
  RAISE NOTICE 'Online C Suite database extensions initialized successfully';
END
$$;
