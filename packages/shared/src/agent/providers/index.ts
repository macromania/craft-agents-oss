/**
 * Provider abstraction layer for multi-SDK support.
 * 
 * This module provides a factory for creating provider adapters that allow
 * CraftAgent to work with different AI SDKs (Claude Agent SDK, Copilot SDK)
 * through a unified interface.
 * 
 * Usage:
 *   import { getProviderAdapter, getAvailableProviders } from './providers';
 *   
 *   // Get a specific provider
 *   const adapter = getProviderAdapter('claude');
 *   
 *   // Check which providers are available
 *   const available = await getAvailableProviders();
 */

export * from './types.ts';

import type { ProviderAdapter, ProviderType } from './types.ts';
import { ClaudeAdapter } from './claude-adapter.ts';
import { CopilotAdapter } from './copilot-adapter.ts';

// Singleton adapters - stateless, can be shared across the application
const adapters: Map<ProviderType, ProviderAdapter> = new Map();

/**
 * Get a provider adapter by type.
 * 
 * Adapters are created lazily on first access and cached for reuse.
 * Each adapter is stateless and can be shared across multiple sessions.
 * 
 * @param type - The provider type ('claude' or 'copilot')
 * @returns The provider adapter instance
 * @throws Error if the provider type is unknown
 */
export function getProviderAdapter(type: ProviderType): ProviderAdapter {
  let adapter = adapters.get(type);
  
  if (!adapter) {
    switch (type) {
      case 'claude':
        adapter = new ClaudeAdapter();
        break;
      case 'copilot':
        adapter = new CopilotAdapter();
        break;
      default:
        throw new Error(`Unknown provider type: ${type satisfies never}`);
    }
    adapters.set(type, adapter);
  }
  
  return adapter;
}

/**
 * Check which providers are currently available.
 * 
 * A provider is available if its authentication is configured and
 * any required CLI tools are installed.
 * 
 * @returns Array of available provider types
 */
export async function getAvailableProviders(): Promise<ProviderType[]> {
  const available: ProviderType[] = [];
  const providerTypes: ProviderType[] = ['claude', 'copilot'];
  
  for (const type of providerTypes) {
    const adapter = getProviderAdapter(type);
    if (await adapter.isAvailable()) {
      available.push(type);
    }
  }
  
  return available;
}

/**
 * Get the default provider type.
 * 
 * Returns 'claude' as the default for backwards compatibility.
 * The active provider can be overridden via configuration.
 */
export function getDefaultProviderType(): ProviderType {
  return 'claude';
}

/**
 * Check if a model ID is supported by a given provider.
 * 
 * @param modelId - The model ID to check
 * @param provider - The provider type to check against
 * @returns true if the model is available through the provider
 */
export function isModelSupportedByProvider(modelId: string, provider: ProviderType): boolean {
  const adapter = getProviderAdapter(provider);
  const models = adapter.getAvailableModels();
  return models.some(m => m === modelId || modelId.includes(m));
}

// Re-export adapter classes for direct use if needed
export { ClaudeAdapter } from './claude-adapter.ts';
export { CopilotAdapter } from './copilot-adapter.ts';
