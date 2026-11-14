import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../src/app";

describe("Chat API Integration Tests", () => {
  let server: Server;
  let baseUrl: string;

  before(() => {
    return new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        const port = typeof addr === "object" && addr ? addr.port : 8000;
        baseUrl = `http://localhost:${port}/api`;
        resolve();
      });
    });
  });

  after(() => {
    return new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("GET /api/health should return ok status", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, "ok");
    assert.ok(data.timestamp);
  });

  it("POST /api/chat with empty body should return 400 validation_error", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, "validation_error");
    assert.ok(Array.isArray(data.issues));
    assert.equal(data.issues[0].path, "message");
  });

  it("POST /api/chat with whitespace message should return 400 validation_error", async () => {
    const res = await fetch(`${baseUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, "validation_error");
    assert.equal(data.issues[0].path, "message");
  });

  it(
    "POST /api/chat with simple knowledge question should return 200 and answer directly",
    { timeout: 60000 },
    async () => {
      const res = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "What is the capital of France?" }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data.answer === "string");
      assert.ok(data.answer.toLowerCase().includes("paris"));
      assert.ok(Array.isArray(data.steps));
      assert.ok(Array.isArray(data.sources));
    }
  );

  it(
    "POST /api/chat with time-sensitive query should execute web search and return sources",
    { timeout: 120000 },
    async () => {
      const res = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "What is the current price of GitHub Copilot Individual?",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data.answer === "string" && data.answer.length > 0);
      assert.ok(Array.isArray(data.sources));
      assert.ok(data.sources.length > 0, "Expected at least 1 web search source");
      assert.ok(Array.isArray(data.steps));
      assert.ok(data.steps.length >= 2, "Expected at least 2 steps (tool call + final answer)");
    }
  );

  it(
    "POST /api/chat with multi-entity comparison query should execute parallel searches and return sources",
    { timeout: 120000 },
    async () => {
      const res = await fetch(`${baseUrl}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: "Compare the current pricing of Vercel and Netlify pro tiers",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(typeof data.answer === "string" && data.answer.length > 0);
      assert.ok(Array.isArray(data.sources));
      assert.ok(data.sources.length >= 2, "Expected multiple sources for comparison query");
      assert.ok(Array.isArray(data.steps));
      assert.ok(data.steps.length >= 2, "Expected multi-step agent execution");
    }
  );
});
