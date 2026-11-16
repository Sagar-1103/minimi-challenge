-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_messages_embedding_hnsw" ON "messages" USING hnsw ("embedding" vector_cosine_ops);
