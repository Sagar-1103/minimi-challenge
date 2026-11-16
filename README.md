# Mimi

An AI chat agent with live web search, calendar intelligence, factual claim re-verification, and long-term semantic memory powered by PostgreSQL and `pgvector`. Built for the Minimi assignment.

---

## Core Capabilities

- **Live Web Search Orchestration**: Dynamic query decomposition and multi-query parallel execution via Tavily, with automated primary-source vendor domain scoring over aggregator noise.
- **Calendar Intelligence & Temporal Grounding**: Normalizes relative temporal expressions (*"Monday"*, *"last Tuesday"*, *"3 November"*) to UTC midnight timestamps, calculates anchor date deltas, and automatically modernizes outdated training-data years.
- **Dual-Layer Memory**: Turn-level history retrieval for chronological lookups paired with dense semantic vector search (`pgvector` with HNSW cosine index + Gemini 768-dim embeddings) for cross-session recall without keyword overlap.
- **Factual Claim Re-Verification**: Automatically extracts quantitative claims (pricing, storage limits, tier features) from past discussions and validates them against fresh search evidence to produce structured diff verdicts.
- **Real-Time Streaming Protocol**: Server-Sent Events (SSE) streaming pipeline delivering granular lifecycle events (`status`, `tool_start`, `tool_end`, `answer_chunk`, `sources`, `done`).

---

## Architecture Overview

For in-depth architectural decisions, trade-offs, and design rationale, see **[`DESIGN.md`](./DESIGN.md)**.

![Mimi Architecture](./mimi-architecture.png)

---


## Development Guide

### Prerequisites
- **Node.js**: v20.x or v22.x
- **Docker & Docker Compose**: For local PostgreSQL with `pgvector`
- **API Keys**:
  - OpenRouter API Key (Chat LLM)
  - Tavily API Key (Live web search)
  - Gemini API Key (768-dim text embeddings)

---

### 1. Environment Configuration

Copy `.env.example` to `.env` in the project root:

```bash
cp .env.example .env
```

Configure the following variables in `.env`:

```env
# Backend
PORT=8000
API_BASE_URL=http://localhost:8000

# Database (PostgreSQL with pgvector)
DATABASE_URL=postgresql://user:password@localhost:5432/minimi_db

# OpenRouter (Chat LLM)
OPENROUTER_API_KEY=your_openrouter_api_key
OPENROUTER_MODEL=inclusionai/ling-3.2-flash:free
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1

# Tavily (Live Web Search)
TAVILY_API_KEY=your_tavily_api_key

# Embedding Configuration (pgvector Semantic Memory)
EMBEDDING_PROVIDER=gemini
EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_BASE_URL=https://generativelanguage.googleapis.com/v1beta
EMBEDDING_API_KEY=your_gemini_api_key
EMBEDDING_DIMENSIONS=768

# Semantic Search Tuning
VECTOR_SEARCH_THRESHOLD=0.45
VECTOR_SEARCH_LIMIT=5

# Frontend
VITE_PORT=3000
VITE_API_BASE_URL=http://localhost:8000
```

---

### 2. Database Setup

Start the PostgreSQL container with `pgvector` pre-installed:

```bash
docker compose up -d
```

To verify the container is healthy:

```bash
docker compose ps
```

---

### 3. Install Dependencies

Install all root, backend, and frontend dependencies in one command (the root `postinstall` hook handles sub-packages and generates the Prisma client automatically):

```bash
npm install
```

---

### 4. Database Schema Sync

Synchronize the Prisma schema with the PostgreSQL database:

```bash
npm run prisma:push
```

To inspect or manage stored records visually in your browser:

```bash
npm run prisma:studio
```

---

### 5. Running the Application

#### Run Full Stack Concurrently
Starts both the Express backend (`http://localhost:8000`) and the Next.js frontend (`http://localhost:3000`):

```bash
npm run dev
```

#### Run Services Individually
- **Backend only**:
  ```bash
  npm run dev:backend
  ```
- **Frontend only**:
  ```bash
  npm run dev:frontend
  ```

Open [http://localhost:3000](http://localhost:3000) to interact with the chat interface.

---

### 6. Seeding Historical Data

To populate historical benchmark conversation turns with exact timestamps and pre-computed vector embeddings:

```bash
npm run seed:benchmarks
```

---

### 7. Testing & Quality Checks

Run the automated test suite across all modules:

```bash
npm test
```

#### Test Coverage
- **Benchmark Scenarios**: Validates change detection, date lookups, and relative date resolution.
- **Quality & Streaming**: Markdown comparison tables, change tables, confidence calibration, and strict SSE event ordering.
- **Vector Memory**: Explicit recall detection, topic isolation, and conversational tone guardrails.
- **Temporal Grounding**: Date parsing, UTC midnight normalization, anchor date tracking, and query year modernization.
- **Search Service**: Multi-query deduplication, domain authority weighting, and primary source scoring.
- **Conversation Memory**: Ambiguity handling, numerical claim extraction, and history management.
- **Safety & Guardrails**: Prompt injection defense, system prompt spoofing protection, and search loop breakers.

#### Type Checking
To run TypeScript type checks without emitting files:

```bash
# Typecheck backend source code
npx tsc --noEmit -p backend/tsconfig.json

# Typecheck test suite
npx tsc --noEmit -p backend/tests/tsconfig.json
```

---

### 8. Production Build

To compile TypeScript and build the production bundles:

```bash
# Build backend
npm --prefix backend run build

# Build frontend
npm --prefix frontend run build
```
