/**
 * Provider abstraction types for multi-SDK support.
 * Allows CraftAgent to use either Claude Agent SDK or Copilot SDK interchangeably.
 */

import type { AgentEvent } from "@craft-agent/core/types";
import type { FileAttachment } from "../../utils/files.ts";
import type { createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";

/**
 * Provider type identifier
 */
export type ProviderType = "claude" | "copilot";

/**
 * SDK-compatible MCP server configuration.
 * Supports HTTP/SSE (remote) and stdio (local subprocess) transports.
 */
export type SdkMcpServerConfig = { type: "http" | "sse"; url: string; headers?: Record<string, string> } | { type: "stdio"; command: string; args?: string[]; env?: Record<string, string> };

/**
 * System prompt configuration for providers
 */
export interface SystemPromptConfig {
  type: "preset" | "custom";
  preset?: string;
  append?: string;
  content?: string;
}

/**
 * Configuration for initializing a provider query/session
 */
export interface ProviderQueryConfig {
  /** Model ID to use */
  model: string;
  /** System prompt configuration */
  systemPrompt: SystemPromptConfig;
  /** Working directory for file operations */
  cwd: string;
  /** MCP servers to connect (both SDK-created servers and config objects) */
  mcpServers: Record<string, SdkMcpServerConfig | ReturnType<typeof createSdkMcpServer>>;
  /** Tools to disable */
  disallowedTools?: string[];
  /** Maximum thinking tokens (Claude-specific, ignored by other providers) */
  maxThinkingTokens?: number;
  /** Beta features to enable (Claude-specific) */
  betas?: string[];
  /** Session ID for conversation continuity */
  sessionId?: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Stderr handler for subprocess output */
  stderr?: (data: string) => void;
  /** Whether to include partial messages in streaming */
  includePartialMessages?: boolean;
  /** Workspace root path for plugin loading */
  workspaceRootPath?: string;
  /** Permission mode setting */
  permissionMode?: "default" | "bypassPermissions";
  /** Allow skipping permissions flag */
  allowDangerouslySkipPermissions?: boolean;
  /** Hooks for tool interception */
  hooks?: Record<string, unknown>;
  /** Tool preset or custom tools */
  tools?: { type: "preset"; preset: string } | { type: "custom"; tools: unknown[] };
  /** Abort controller for cancellation */
  abortController?: AbortController;
}

/**
 * User message with optional attachments
 */
export interface ProviderMessage {
  content: string;
  attachments?: FileAttachment[];
}

/**
 * Model usage statistics from provider
 */
export interface ProviderModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  contextWindow?: number;
}

/**
 * Query result from a provider
 * Maps to our internal AgentEvent stream
 */
export interface ProviderQueryResult {
  /** Async iterator of SDK-native events (provider-specific) */
  events: AsyncIterable<unknown>;
  /** Session ID returned by the provider (getter for lazy resolution) */
  readonly sessionId?: string;
  /** Model usage statistics (getter for lazy resolution) */
  readonly modelUsage?: ProviderModelUsage;
  /** Abort function to stop the query */
  abort: () => void;
}

/**
 * Provider adapter interface
 * Wraps SDK-specific query/session logic
 */
export interface ProviderAdapter {
  /** Provider identifier */
  readonly name: ProviderType;

  /**
   * Execute a query/message and return an event stream
   * This is the main interaction point - wraps SDK's query() or equivalent
   */
  query(message: ProviderMessage, config: ProviderQueryConfig): Promise<ProviderQueryResult>;

  /**
   * Check if the provider is available (auth configured, CLI installed, etc.)
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get list of models available through this provider
   */
  getAvailableModels(): string[];

  /**
   * Map provider-specific event to AgentEvent
   * Called by CraftAgent to normalize events
   * @returns AgentEvent or null if event should be skipped
   */
  mapEvent(event: unknown): AgentEvent | null;

  /**
   * Provider-specific environment variables needed (set before query)
   */
  getEnvironment(): Record<string, string>;
}

/**
 * Model definition with provider info
 */
export interface ProviderModelDefinition {
  id: string;
  name: string;
  shortName: string;
  description: string;
  contextWindow?: number;
  provider: ProviderType;
}
