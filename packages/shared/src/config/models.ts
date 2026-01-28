/**
 * Centralized model definitions for the entire application.
 * Update model IDs here when new versions are released.
 */

import type { ProviderType } from "../agent/providers/types.ts";

export interface ModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  /** Known context window size in tokens (used as fallback before SDK reports usage) */
  contextWindow?: number;
}

// ============================================
// USER-SELECTABLE MODELS (shown in UI)
// ============================================

/** Claude models available through Anthropic/Claude SDK */
export const MODELS: ModelDefinition[] = [
  { id: "claude-opus-4-5-20251101", name: "Opus 4.5", shortName: "Opus", description: "Most capable", contextWindow: 200000 },
  { id: "claude-sonnet-4-5-20250929", name: "Sonnet 4.5", shortName: "Sonnet", description: "Balanced", contextWindow: 200000 },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", shortName: "Haiku", description: "Fast & efficient", contextWindow: 200000 },
];

/** Models available through GitHub Copilot SDK */
export const COPILOT_MODELS: ModelDefinition[] = [
  { id: "gpt-5", name: "GPT-5", shortName: "GPT-5", description: "OpenAI flagship", contextWindow: 128000 },
  { id: "gpt-4.1", name: "GPT-4.1", shortName: "GPT-4.1", description: "OpenAI balanced", contextWindow: 128000 },
  { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5", shortName: "Sonnet", description: "Via Copilot", contextWindow: 200000 },
  { id: "claude-haiku-4.5", name: "Claude Haiku 4.5", shortName: "Haiku", description: "Fast via Copilot", contextWindow: 200000 },
];

// ============================================
// PURPOSE-SPECIFIC DEFAULTS
// ============================================

/** Default model for main chat (user-facing) */
export const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

/** Default models per provider */
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderType, string> = {
  claude: "claude-sonnet-4-5-20250929",
  copilot: "gpt-4.1",
};

/** Model for agent definition extraction (always high quality) */
export const EXTRACTION_MODEL = "claude-opus-4-5-20251101";

/** Model for API response summarization (cost efficient) */
export const SUMMARIZATION_MODEL = "claude-haiku-4-5-20251001";

/** Model for instruction updates (high quality for accurate document editing) */
export const INSTRUCTION_UPDATE_MODEL = "claude-opus-4-5-20251101";

// ============================================
// HELPER FUNCTIONS
// ============================================

/** Get display name for a model ID (full name with version) */
export function getModelDisplayName(modelId: string): string {
  const model = MODELS.find((m) => m.id === modelId);
  if (model) return model.name;
  // Fallback: strip prefix and date suffix
  return modelId.replace("claude-", "").replace(/-\d{8}$/, "");
}

/** Get short display name for a model ID (without version number) */
export function getModelShortName(modelId: string): string {
  const model = MODELS.find((m) => m.id === modelId);
  if (model) return model.shortName;
  // For provider-prefixed IDs (e.g. "openai/gpt-5"), show just the model part
  if (modelId.includes("/")) {
    return modelId.split("/").pop() || modelId;
  }
  // Fallback: strip claude- prefix and date suffix
  return modelId.replace("claude-", "").replace(/-[\d.-]+$/, "");
}

/** Get known context window size for a model ID (fallback when SDK hasn't reported usage yet) */
export function getModelContextWindow(modelId: string): number | undefined {
  return MODELS.find((m) => m.id === modelId)?.contextWindow;
}

/** Check if model is an Opus model (for cache TTL decisions) */
export function isOpusModel(modelId: string): boolean {
  return modelId.includes("opus");
}

/**
 * Check if a model ID refers to a Claude model.
 * Handles both direct Anthropic IDs (e.g. "claude-sonnet-4-5-20250929")
 * and provider-prefixed IDs (e.g. "anthropic/claude-sonnet-4" via OpenRouter).
 */
export function isClaudeModel(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return lower.startsWith("claude-") || lower.includes("/claude");
}

// ============================================
// PROVIDER-AWARE HELPERS
// ============================================

/**
 * Get models available for a specific provider.
 * @param provider - The provider type ('claude' or 'copilot')
 * @returns Array of model definitions available for the provider
 */
export function getModelsForProvider(provider: ProviderType): ModelDefinition[] {
  switch (provider) {
    case "copilot":
      return COPILOT_MODELS;
    case "claude":
    default:
      return MODELS;
  }
}

/**
 * Get the default model for a provider.
 * @param provider - The provider type ('claude' or 'copilot')
 * @returns The default model ID for the provider
 */
export function getDefaultModelForProvider(provider: ProviderType): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;
}

/**
 * Check if a model ID is compatible with a specific provider.
 * @param modelId - The model ID to check
 * @param provider - The provider type to check against
 * @returns true if the model is available through the provider
 */
export function isModelForProvider(modelId: string, provider: ProviderType): boolean {
  const models = getModelsForProvider(provider);
  return models.some((m) => m.id === modelId);
}

/**
 * Get model display name with provider awareness.
 * Searches both MODELS and COPILOT_MODELS.
 */
export function getModelDisplayNameAnyProvider(modelId: string): string {
  const model = MODELS.find((m) => m.id === modelId) ?? COPILOT_MODELS.find((m) => m.id === modelId);
  if (model) return model.name;
  // Fallback for unknown models
  if (modelId.includes("/")) {
    return modelId.split("/").pop() || modelId;
  }
  return modelId.replace("claude-", "").replace(/-\d{8}$/, "");
}

/**
 * Get model context window with provider awareness.
 * Searches both MODELS and COPILOT_MODELS.
 */
export function getModelContextWindowAnyProvider(modelId: string): number | undefined {
  return MODELS.find((m) => m.id === modelId)?.contextWindow ?? COPILOT_MODELS.find((m) => m.id === modelId)?.contextWindow;
}
