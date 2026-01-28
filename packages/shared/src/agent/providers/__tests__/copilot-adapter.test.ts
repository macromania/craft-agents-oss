/**
 * Tests for CopilotAdapter provider implementation.
 *
 * Verifies that the GitHub Copilot SDK wrapper correctly implements the
 * ProviderAdapter interface and properly maps Copilot events to AgentEvents.
 *
 * Note: The CopilotAdapter is currently in stub/preview mode. These tests
 * verify the interface contract and event mapping logic, which will remain
 * stable even as the underlying SDK integration is completed.
 */
import { describe, it, expect, beforeEach, mock } from "bun:test";
import { CopilotAdapter } from "../copilot-adapter.ts";

describe("CopilotAdapter", () => {
  let adapter: CopilotAdapter;

  beforeEach(() => {
    adapter = new CopilotAdapter();
  });

  describe("name", () => {
    it('should return "copilot" as the provider name', () => {
      expect(adapter.name).toBe("copilot");
    });
  });

  describe("isAvailable", () => {
    // Note: isAvailable() checks for the Copilot CLI which may not be installed
    // in CI environments. These tests verify the return type and handle both cases.

    it("should return a boolean", async () => {
      const result = await adapter.isAvailable();
      expect(typeof result).toBe("boolean");
    });

    it("should not throw when CLI is not installed", async () => {
      // This test ensures graceful handling when copilot CLI is missing
      // The method should return a boolean value without throwing
      let result: boolean | undefined;
      let didThrow = false;
      try {
        result = await adapter.isAvailable();
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(false);
      expect(typeof result).toBe("boolean");
    });
  });

  describe("getAvailableModels", () => {
    it("should return an array of model IDs", () => {
      const models = adapter.getAvailableModels();
      expect(Array.isArray(models)).toBe(true);
      expect(models.length).toBeGreaterThan(0);
    });

    it("should include gpt-5", () => {
      const models = adapter.getAvailableModels();
      expect(models).toContain("gpt-5");
    });

    it("should include gpt-4.1", () => {
      const models = adapter.getAvailableModels();
      expect(models).toContain("gpt-4.1");
    });

    it("should include claude-sonnet-4.5 (via Copilot)", () => {
      const models = adapter.getAvailableModels();
      expect(models).toContain("claude-sonnet-4.5");
    });

    it("should include claude-haiku-4.5 (via Copilot)", () => {
      const models = adapter.getAvailableModels();
      expect(models).toContain("claude-haiku-4.5");
    });

    it("should have exactly 4 models (current supported set)", () => {
      const models = adapter.getAvailableModels();
      expect(models.length).toBe(4);
    });
  });

  describe("mapEvent", () => {
    describe("assistant.message_delta events", () => {
      it("should map to text_delta AgentEvent", () => {
        const event = adapter.mapEvent({
          type: "assistant.message_delta",
          content: "Hello, world!",
        });
        expect(event).toEqual({
          type: "text_delta",
          text: "Hello, world!",
        });
      });

      it("should handle empty content", () => {
        const event = adapter.mapEvent({
          type: "assistant.message_delta",
          content: "",
        });
        expect(event).toEqual({
          type: "text_delta",
          text: "",
        });
      });

      it("should handle missing content", () => {
        const event = adapter.mapEvent({
          type: "assistant.message_delta",
        });
        expect(event).toEqual({
          type: "text_delta",
          text: "",
        });
      });
    });

    describe("assistant.message events", () => {
      it("should map to text_complete AgentEvent", () => {
        const event = adapter.mapEvent({
          type: "assistant.message",
          content: "Complete message",
        });
        expect(event).toEqual({
          type: "text_complete",
          text: "Complete message",
          isIntermediate: false,
        });
      });

      it("should handle missing content", () => {
        const event = adapter.mapEvent({
          type: "assistant.message",
        });
        expect(event).toEqual({
          type: "text_complete",
          text: "",
          isIntermediate: false,
        });
      });
    });

    describe("assistant.reasoning events", () => {
      it("should map to text_delta for thinking display", () => {
        const event = adapter.mapEvent({
          type: "assistant.reasoning",
          content: "Let me think about this...",
        });
        expect(event).toEqual({
          type: "text_delta",
          text: "Let me think about this...",
        });
      });
    });

    describe("tool.execution_start events", () => {
      it("should map to tool_start AgentEvent", () => {
        const event = adapter.mapEvent({
          type: "tool.execution_start",
          toolName: "read_file",
          toolUseId: "tool-123",
          input: { path: "/test/file.ts" },
        });
        expect(event).toEqual({
          type: "tool_start",
          toolName: "read_file",
          toolUseId: "tool-123",
          input: { path: "/test/file.ts" },
        });
      });

      it("should provide defaults for missing fields", () => {
        const event = adapter.mapEvent({
          type: "tool.execution_start",
        });
        expect(event).toMatchObject({
          type: "tool_start",
          toolName: "unknown",
          input: {},
        });
        // toolUseId should be generated
        expect((event as any).toolUseId).toMatch(/^tool-\d+$/);
      });
    });

    describe("tool.execution_complete events", () => {
      it("should map to tool_result AgentEvent for success", () => {
        const event = adapter.mapEvent({
          type: "tool.execution_complete",
          toolUseId: "tool-123",
          result: "File contents here",
          isError: false,
        });
        expect(event).toEqual({
          type: "tool_result",
          toolUseId: "tool-123",
          result: "File contents here",
          isError: false,
        });
      });

      it("should map to tool_result AgentEvent for error", () => {
        const event = adapter.mapEvent({
          type: "tool.execution_complete",
          toolUseId: "tool-123",
          result: "File not found",
          isError: true,
        });
        expect(event).toEqual({
          type: "tool_result",
          toolUseId: "tool-123",
          result: "File not found",
          isError: true,
        });
      });

      it("should default isError to false", () => {
        const event = adapter.mapEvent({
          type: "tool.execution_complete",
          toolUseId: "tool-456",
          result: "Success",
        });
        expect(event).toEqual({
          type: "tool_result",
          toolUseId: "tool-456",
          result: "Success",
          isError: false,
        });
      });
    });

    describe("session.error events", () => {
      it("should map to error AgentEvent", () => {
        const event = adapter.mapEvent({
          type: "session.error",
          message: "Connection failed",
        });
        expect(event).toEqual({
          type: "error",
          message: "Connection failed",
        });
      });

      it("should provide default message when missing", () => {
        const event = adapter.mapEvent({
          type: "session.error",
        });
        expect(event).toEqual({
          type: "error",
          message: "Unknown Copilot error",
        });
      });
    });

    describe("session.idle events", () => {
      it("should map to complete AgentEvent", () => {
        const event = adapter.mapEvent({
          type: "session.idle",
        });
        expect(event).toEqual({
          type: "complete",
        });
      });
    });

    describe("unknown events", () => {
      it("should return null for unknown event types", () => {
        const event = adapter.mapEvent({
          type: "unknown.event.type",
        });
        expect(event).toBeNull();
      });

      it("should handle empty objects", () => {
        const event = adapter.mapEvent({});
        expect(event).toBeNull();
      });

      it("should handle events without type", () => {
        const event = adapter.mapEvent({ content: "test" });
        expect(event).toBeNull();
      });
    });
  });

  describe("getEnvironment", () => {
    it("should return an empty object (Copilot uses GitHub CLI auth)", () => {
      const env = adapter.getEnvironment();
      expect(env).toEqual({});
    });
  });

  describe("query (stub implementation)", () => {
    it("should return a ProviderQueryResult with events iterator", async () => {
      const result = await adapter.query(
        { content: "Hello" },
        {
          model: "gpt-4.1",
          systemPrompt: { type: "custom", content: "You are helpful" },
          cwd: "/test",
          mcpServers: {},
        }
      );

      expect(result).toHaveProperty("events");
      expect(result).toHaveProperty("abort");
      expect(typeof result.abort).toBe("function");
    });

    it("should yield stub events for unimplemented SDK", async () => {
      const result = await adapter.query(
        { content: "Hello" },
        {
          model: "gpt-4.1",
          systemPrompt: { type: "custom", content: "Test" },
          cwd: "/test",
          mcpServers: {},
        }
      );

      const events: unknown[] = [];
      for await (const event of result.events) {
        events.push(event);
      }

      // Should yield at least an informational message
      expect(events.length).toBeGreaterThan(0);
      expect(events[events.length - 1]).toMatchObject({ type: "session.idle" });
    });

    it("should provide abort function that can be called", async () => {
      const result = await adapter.query(
        { content: "Test" },
        {
          model: "gpt-4.1",
          systemPrompt: { type: "custom", content: "" },
          cwd: "/test",
          mcpServers: {},
        }
      );

      // Should not throw when called
      expect(() => result.abort()).not.toThrow();
    });
  });
});

describe("CopilotAdapter static behavior", () => {
  it("should be instantiable multiple times", () => {
    const adapter1 = new CopilotAdapter();
    const adapter2 = new CopilotAdapter();
    expect(adapter1).not.toBe(adapter2);
    expect(adapter1.name).toBe(adapter2.name);
  });

  it("should be stateless (same models from different instances)", () => {
    const adapter1 = new CopilotAdapter();
    const adapter2 = new CopilotAdapter();
    expect(adapter1.getAvailableModels()).toEqual(adapter2.getAvailableModels());
  });
});
