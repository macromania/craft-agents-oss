/**
 * Provider Integration Tests
 *
 * Tests for the provider abstraction layer ensuring that:
 * 1. Provider switching works correctly
 * 2. Model compatibility is validated when switching providers
 * 3. MCP servers are handled consistently across providers
 * 4. The factory returns correct adapter types
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getProviderAdapter, getAvailableProviders, getDefaultProviderType, isModelSupportedByProvider, type ProviderType } from "../providers/index.ts";
import { getModelsForProvider, getDefaultModelForProvider, isModelForProvider, MODELS, COPILOT_MODELS } from "../../config/models.ts";

describe("Provider Factory", () => {
  describe("getProviderAdapter", () => {
    it('should return ClaudeAdapter for "claude" provider', () => {
      const adapter = getProviderAdapter("claude");
      expect(adapter.name).toBe("claude");
    });

    it('should return CopilotAdapter for "copilot" provider', () => {
      const adapter = getProviderAdapter("copilot");
      expect(adapter.name).toBe("copilot");
    });

    it("should return the same instance on subsequent calls (singleton)", () => {
      const adapter1 = getProviderAdapter("claude");
      const adapter2 = getProviderAdapter("claude");
      expect(adapter1).toBe(adapter2);
    });

    it("should return different instances for different providers", () => {
      const claudeAdapter = getProviderAdapter("claude");
      const copilotAdapter = getProviderAdapter("copilot");
      expect(claudeAdapter).not.toBe(copilotAdapter);
      expect(claudeAdapter.name).not.toBe(copilotAdapter.name);
    });

    it("should throw for unknown provider type", () => {
      // @ts-expect-error Testing invalid provider type
      expect(() => getProviderAdapter("invalid")).toThrow("Unknown provider type");
    });
  });

  describe("getDefaultProviderType", () => {
    it('should return "claude" as the default provider', () => {
      expect(getDefaultProviderType()).toBe("claude");
    });

    it("should return a valid ProviderType", () => {
      const defaultType = getDefaultProviderType();
      expect(["claude", "copilot"]).toContain(defaultType);
    });
  });

  describe("isModelSupportedByProvider", () => {
    it("should return true for Claude models with Claude provider", () => {
      expect(isModelSupportedByProvider("claude-sonnet-4-5-20250929", "claude")).toBe(true);
      expect(isModelSupportedByProvider("claude-opus-4-5-20251101", "claude")).toBe(true);
      expect(isModelSupportedByProvider("claude-haiku-4-5-20251001", "claude")).toBe(true);
    });

    it("should return true for Copilot models with Copilot provider", () => {
      expect(isModelSupportedByProvider("gpt-5", "copilot")).toBe(true);
      expect(isModelSupportedByProvider("gpt-4.1", "copilot")).toBe(true);
      expect(isModelSupportedByProvider("claude-sonnet-4.5", "copilot")).toBe(true);
    });

    it("should return false for mismatched provider/model", () => {
      expect(isModelSupportedByProvider("gpt-5", "claude")).toBe(false);
      expect(isModelSupportedByProvider("claude-sonnet-4-5-20250929", "copilot")).toBe(false);
    });
  });
});

describe("Provider Availability", () => {
  describe("getAvailableProviders", () => {
    it("should return an array", async () => {
      const providers = await getAvailableProviders();
      expect(Array.isArray(providers)).toBe(true);
    });

    it("should only contain valid provider types", async () => {
      const providers = await getAvailableProviders();
      const validTypes: ProviderType[] = ["claude", "copilot"];
      for (const provider of providers) {
        expect(validTypes).toContain(provider);
      }
    });

    it("should not have duplicate entries", async () => {
      const providers = await getAvailableProviders();
      const uniqueProviders = [...new Set(providers)];
      expect(providers.length).toBe(uniqueProviders.length);
    });
  });
});

describe("Model Configuration by Provider", () => {
  describe("getModelsForProvider", () => {
    it("should return MODELS for claude provider", () => {
      const models = getModelsForProvider("claude");
      expect(models).toBe(MODELS);
    });

    it("should return COPILOT_MODELS for copilot provider", () => {
      const models = getModelsForProvider("copilot");
      expect(models).toBe(COPILOT_MODELS);
    });

    it("should return non-empty arrays for all providers", () => {
      const claudeModels = getModelsForProvider("claude");
      const copilotModels = getModelsForProvider("copilot");
      expect(claudeModels.length).toBeGreaterThan(0);
      expect(copilotModels.length).toBeGreaterThan(0);
    });

    it("should have different models for different providers", () => {
      const claudeModels = getModelsForProvider("claude");
      const copilotModels = getModelsForProvider("copilot");
      // Check that there's at least one model unique to each provider
      const claudeIds = claudeModels.map((m) => m.id);
      const copilotIds = copilotModels.map((m) => m.id);
      expect(claudeIds.some((id) => !copilotIds.includes(id))).toBe(true);
      expect(copilotIds.some((id) => !claudeIds.includes(id))).toBe(true);
    });
  });

  describe("getDefaultModelForProvider", () => {
    it("should return a valid model ID for claude provider", () => {
      const defaultModel = getDefaultModelForProvider("claude");
      expect(typeof defaultModel).toBe("string");
      expect(defaultModel.length).toBeGreaterThan(0);
    });

    it("should return a valid model ID for copilot provider", () => {
      const defaultModel = getDefaultModelForProvider("copilot");
      expect(typeof defaultModel).toBe("string");
      expect(defaultModel.length).toBeGreaterThan(0);
    });

    it("should return a model that belongs to the provider", () => {
      const claudeDefault = getDefaultModelForProvider("claude");
      const copilotDefault = getDefaultModelForProvider("copilot");
      expect(isModelForProvider(claudeDefault, "claude")).toBe(true);
      expect(isModelForProvider(copilotDefault, "copilot")).toBe(true);
    });

    it("should return different defaults for different providers", () => {
      const claudeDefault = getDefaultModelForProvider("claude");
      const copilotDefault = getDefaultModelForProvider("copilot");
      expect(claudeDefault).not.toBe(copilotDefault);
    });
  });

  describe("isModelForProvider", () => {
    it("should correctly identify Claude models", () => {
      expect(isModelForProvider("claude-sonnet-4-5-20250929", "claude")).toBe(true);
      expect(isModelForProvider("claude-opus-4-5-20251101", "claude")).toBe(true);
      expect(isModelForProvider("claude-haiku-4-5-20251001", "claude")).toBe(true);
    });

    it("should correctly identify Copilot models", () => {
      expect(isModelForProvider("gpt-5", "copilot")).toBe(true);
      expect(isModelForProvider("gpt-4.1", "copilot")).toBe(true);
      expect(isModelForProvider("claude-sonnet-4.5", "copilot")).toBe(true);
      expect(isModelForProvider("claude-haiku-4.5", "copilot")).toBe(true);
    });

    it("should return false for unknown models", () => {
      expect(isModelForProvider("unknown-model-xyz", "claude")).toBe(false);
      expect(isModelForProvider("unknown-model-xyz", "copilot")).toBe(false);
    });

    it("should return false for cross-provider models", () => {
      // Claude SDK models should not be valid for Copilot provider
      expect(isModelForProvider("claude-sonnet-4-5-20250929", "copilot")).toBe(false);
      // Copilot models should not be valid for Claude provider
      expect(isModelForProvider("gpt-5", "claude")).toBe(false);
    });
  });
});

describe("Provider Switching Scenarios", () => {
  describe("switching from Claude to Copilot", () => {
    it("should require model change (Claude models not in Copilot)", () => {
      const claudeModel = "claude-sonnet-4-5-20250929";
      const isValidForCopilot = isModelForProvider(claudeModel, "copilot");
      expect(isValidForCopilot).toBe(false);
      // User should switch to Copilot default
      const copilotDefault = getDefaultModelForProvider("copilot");
      expect(isModelForProvider(copilotDefault, "copilot")).toBe(true);
    });
  });

  describe("switching from Copilot to Claude", () => {
    it("should require model change (Copilot models not in Claude SDK list)", () => {
      const copilotModel = "gpt-4.1";
      const isValidForClaude = isModelForProvider(copilotModel, "claude");
      expect(isValidForClaude).toBe(false);
      // User should switch to Claude default
      const claudeDefault = getDefaultModelForProvider("claude");
      expect(isModelForProvider(claudeDefault, "claude")).toBe(true);
    });
  });
});

describe("Provider Adapter Interface Compliance", () => {
  const providerTypes: ProviderType[] = ["claude", "copilot"];

  for (const providerType of providerTypes) {
    describe(`${providerType} adapter`, () => {
      it("should implement the name property", () => {
        const adapter = getProviderAdapter(providerType);
        expect(adapter.name).toBe(providerType);
      });

      it("should implement isAvailable() method", () => {
        const adapter = getProviderAdapter(providerType);
        expect(typeof adapter.isAvailable).toBe("function");
      });

      it("should implement getAvailableModels() method", () => {
        const adapter = getProviderAdapter(providerType);
        expect(typeof adapter.getAvailableModels).toBe("function");
        const models = adapter.getAvailableModels();
        expect(Array.isArray(models)).toBe(true);
      });

      it("should implement mapEvent() method", () => {
        const adapter = getProviderAdapter(providerType);
        expect(typeof adapter.mapEvent).toBe("function");
      });

      it("should implement getEnvironment() method", () => {
        const adapter = getProviderAdapter(providerType);
        expect(typeof adapter.getEnvironment).toBe("function");
        const env = adapter.getEnvironment();
        expect(typeof env).toBe("object");
      });

      it("should implement query() method", () => {
        const adapter = getProviderAdapter(providerType);
        expect(typeof adapter.query).toBe("function");
      });
    });
  }
});

describe("MCP Server Handling", () => {
  // MCP servers should work consistently across providers

  it("both adapters should accept mcpServers in query config", async () => {
    const mcpConfig = {
      testServer: {
        type: "http" as const,
        url: "http://localhost:3000/mcp",
      },
    };

    const claudeAdapter = getProviderAdapter("claude");
    const copilotAdapter = getProviderAdapter("copilot");

    // Just verify that the config shape is accepted
    // (actual MCP connectivity requires running servers)
    const baseConfig = {
      model: "test-model",
      systemPrompt: { type: "custom" as const, content: "test" },
      cwd: "/test",
      mcpServers: mcpConfig,
    };

    // These should not throw type errors
    expect(() => {
      // Claude adapter accepts the config
      void claudeAdapter.query({ content: "test" }, baseConfig);
    }).not.toThrow();

    expect(() => {
      // Copilot adapter accepts the config
      void copilotAdapter.query({ content: "test" }, baseConfig);
    }).not.toThrow();
  });
});
