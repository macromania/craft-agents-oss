/**
 * useProvider - Hook for accessing the current AI provider (claude or copilot)
 *
 * Fetches the provider setting from main process on mount and caches it.
 * Re-fetches when the window regains focus to pick up changes from settings.
 */

import { useState, useEffect, useCallback } from "react";
import type { ProviderType } from "@craft-agent/shared/agent/providers/types";

/**
 * Hook to get and manage the current AI provider.
 *
 * @returns Object with:
 *   - provider: Current provider ('claude' or 'copilot')
 *   - isLoading: True while fetching initial provider
 *   - setProvider: Function to change the provider
 *   - refreshProvider: Function to re-fetch provider from main process
 */
export function useProvider() {
  const [provider, setProviderState] = useState<ProviderType>("claude");
  const [isLoading, setIsLoading] = useState(true);

  // Fetch provider from main process
  const fetchProvider = useCallback(async () => {
    try {
      const result = await window.electronAPI.getProvider();
      setProviderState(result as ProviderType);
    } catch (error) {
      console.error("[useProvider] Failed to fetch provider:", error);
      // Default to 'claude' on error
      setProviderState("claude");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Set provider via IPC and update local state
  const setProvider = useCallback(async (newProvider: ProviderType) => {
    try {
      await window.electronAPI.setProvider(newProvider);
      setProviderState(newProvider);
    } catch (error) {
      console.error("[useProvider] Failed to set provider:", error);
    }
  }, []);

  // Initial fetch on mount
  useEffect(() => {
    fetchProvider();
  }, [fetchProvider]);

  // Re-fetch when window regains focus (to pick up changes from settings)
  useEffect(() => {
    const handleFocus = () => {
      fetchProvider();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [fetchProvider]);

  return {
    provider,
    isLoading,
    setProvider,
    refreshProvider: fetchProvider,
  };
}
