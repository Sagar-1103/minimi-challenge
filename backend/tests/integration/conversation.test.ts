import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../src/app";

describe("Conversation & Multi-turn API Integration Tests", () => {
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

  it("GET /api/conversations should return paginated conversations list", async () => {
    const res = await fetch(`${baseUrl}/conversations`);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.items));
    assert.equal(typeof data.total, "number");
    assert.equal(typeof data.page, "number");
    assert.equal(typeof data.limit, "number");
  });

  it("GET /api/conversations with invalid limit query should return 400 validation_error", async () => {
    const res = await fetch(`${baseUrl}/conversations?limit=0`);
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, "validation_error");
    assert.ok(Array.isArray(data.issues));
  });

  it("GET /api/conversations/:id for non-existent ID should return 404", async () => {
    const res = await fetch(`${baseUrl}/conversations/00000000-0000-0000-0000-000000000000`);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, "not_found");
  });

  it("PATCH /api/conversations/:id with empty title should return 400 validation_error", async () => {
    const res = await fetch(`${baseUrl}/conversations/some-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.success, false);
    assert.equal(data.error, "validation_error");
  });

  describe("Multi-turn Conversation Flow", () => {
    let createdConversationId: string;

    it(
      "Turn 1: POST /api/chat without conversationId should create conversation and store user memory",
      { timeout: 60000 },
      async () => {
        const res = await fetch(`${baseUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: "My project codename is Operation Bluefin.",
          }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.ok(data.conversationId, "Expected conversationId to be returned");
        assert.ok(data.messageId, "Expected messageId to be returned");
        assert.ok(typeof data.answer === "string");
        createdConversationId = data.conversationId;
      }
    );

    it("GET /api/conversations/:id should retrieve the conversation and its persisted messages", async () => {
      assert.ok(createdConversationId, "Prior turn did not return a conversationId");

      const res = await fetch(`${baseUrl}/conversations/${createdConversationId}`);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.conversation.id, createdConversationId);
      assert.ok(Array.isArray(data.conversation.messages));
      assert.ok(data.conversation.messages.length >= 2, "Expected at least user and assistant messages");

      const userMsg = data.conversation.messages.find((m: { role: string }) => m.role === "user");
      assert.ok(userMsg);
      assert.ok(userMsg.content.includes("Operation Bluefin"));
    });

    it(
      "Turn 2: POST /api/chat with conversationId should recall prior turn context",
      { timeout: 60000 },
      async () => {
        assert.ok(createdConversationId, "Prior turn did not return a conversationId");

        const res = await fetch(`${baseUrl}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: createdConversationId,
            message: "What is my project codename?",
          }),
        });

        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.conversationId, createdConversationId);
        assert.ok(typeof data.answer === "string");
        assert.match(
          data.answer.toLowerCase(),
          /operation\s+bluefin/i,
          "Expected answer to recall 'Operation Bluefin'"
        );
      }
    );

    it("PATCH /api/conversations/:id should update the title", async () => {
      assert.ok(createdConversationId, "Prior turn did not return a conversationId");

      const res = await fetch(`${baseUrl}/conversations/${createdConversationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Operation Bluefin Project",
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);
      assert.equal(data.conversation.title, "Operation Bluefin Project");
    });

    it("DELETE /api/conversations/:id should delete conversation and cascade messages", async () => {
      assert.ok(createdConversationId, "Prior turn did not return a conversationId");

      const res = await fetch(`${baseUrl}/conversations/${createdConversationId}`, {
        method: "DELETE",
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.success, true);

      // Verify deletion
      const checkRes = await fetch(`${baseUrl}/conversations/${createdConversationId}`);
      assert.equal(checkRes.status, 404);
    });
  });
});
