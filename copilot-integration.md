# GitHub Copilot SDK Integration Plan

## Overview

Integrate the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) (`@github/copilot-sdk`) as an alternative AI provider alongside the existing Claude Agent SDK. This enables users to leverage their existing GitHub Copilot subscription instead of requiring a separate Anthropic API key or Claude subscription.

## Development Guidelines

Per [CONTRIBUTING.md](CONTRIBUTING.md):

- **Branch**: `feature/copilot-integration`
- **Type Check**: Run `bun run typecheck:all` before each commit
- **Key Directories**:
  - Agent Logic: `packages/shared/src/agent/`
  - Credentials: `packages/shared/src/credentials/`
  - MCP Integration: `packages/shared/src/mcp/`
  - Types: `packages/core/src/types/`
  - Config/Models: `packages/shared/src/config/`
  - Electron App: `apps/electron/`

---

## Background

### Current Architecture

Craft Agents currently uses the `@anthropic-ai/claude-agent-sdk` (v0.2.19) which:
- Spawns a CLI subprocess that communicates via JSON-RPC
- Supports Claude models exclusively (Opus 4.5, Sonnet 4.5, Haiku 4.5)
- Authenticates via Anthropic API key or Claude OAuth token
- Provides tool execution, streaming, and session management
- Uses `query()` function for message handling with `Options` configuration

**Key implementation in `craft-agent.ts`:**
- `CraftAgent` class manages sessions, permissions, MCP servers, and message processing
- `chat()` async generator yields `AgentEvent` types for UI rendering
- Integrates with permission mode system (safe/normal/auto modes)
- Supports thinking levels (off/think/max) and MCP tool integration

### GitHub Copilot SDK

The Copilot SDK has a remarkably similar architecture:
- Also uses JSON-RPC to communicate with a CLI subprocess (`copilot` CLI)
- Supports **multiple models**: GPT-5, GPT-4.1, Claude Sonnet 4.5, Claude Haiku 4.5
- Authenticates via GitHub Copilot CLI (uses existing GitHub auth)
- Provides equivalent features: tools, streaming, sessions, MCP support

### Key Similarities

| Feature | Claude Agent SDK | Copilot SDK |
|---------|------------------|-------------|
| Transport | JSON-RPC to CLI | JSON-RPC to CLI |
| Streaming | ✅ | ✅ |
| Custom Tools | ✅ (Zod schemas) | ✅ (Zod schemas) |
| MCP Servers | ✅ | ✅ |
| System Prompt | ✅ (preset/append) | ✅ (`systemMessage`) |
| Session Mgmt | ✅ | ✅ (`CopilotSession`) |

---

## Phase 1: Provider Abstraction Layer

**Goal:** Create a provider abstraction that allows `CraftAgent` to use either the Claude Agent SDK or Copilot SDK interchangeably, while preserving all existing functionality.

**Approach:** Rather than creating a heavy abstraction layer, we'll use a **thin adapter pattern** that wraps the SDK-specific `query()` call while keeping `CraftAgent` largely unchanged. This minimizes risk and preserves the battle-tested event handling logic.

### Task 1.1: Create Provider Types

**File:** `packages/shared/src/agent/providers/types.ts`

Define the interface for SDK providers. This should align with our existing `AgentEvent` types from `@craft-agent/core/types`:

```typescript
import type { AgentEvent } from '@craft-agent/core/types';
import type { FileAttachment } from '../../utils/files.ts';
import type { SdkMcpServerConfig } from '../craft-agent.ts';

/**
 * Provider type identifier
 */
export type ProviderType = 'claude' | 'copilot';

/**
 * Configuration for initializing a provider query/session
 */
export interface ProviderQueryConfig {
  /** Model ID to use */
  model: string;
  /** System prompt configuration */
  systemPrompt: {
    type: 'preset' | 'custom';
    preset?: string;
    append?: string;
    content?: string;
  };
  /** Working directory for file operations */
  cwd: string;
  /** MCP servers to connect */
  mcpServers: Record<string, SdkMcpServerConfig | ReturnType<typeof import('@anthropic-ai/claude-agent-sdk').createSdkMcpServer>>;
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
}

/**
 * User message with optional attachments
 */
export interface ProviderMessage {
  content: string;
  attachments?: FileAttachment[];
}

/**
 * Query result from a provider
 * Maps to our internal AgentEvent stream
 */
export interface ProviderQueryResult {
  /** Async iterator of SDK-native events (provider-specific) */
  events: AsyncIterable<unknown>;
  /** Session ID returned by the provider */
  sessionId?: string;
  /** Model usage statistics */
  modelUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
    contextWindow?: number;
  };
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
  query(
    message: ProviderMessage,
    config: ProviderQueryConfig
  ): Promise<ProviderQueryResult>;
  
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
```

### Task 1.2: Create Claude Provider Adapter

**File:** `packages/shared/src/agent/providers/claude-adapter.ts`

Wrap the existing Claude Agent SDK usage into an adapter:

```typescript
import { query, type Query, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderAdapter, ProviderMessage, ProviderQueryConfig, ProviderQueryResult } from './types.ts';
import type { AgentEvent } from '@craft-agent/core/types';
import { getDefaultOptions } from '../options.ts';

export class ClaudeAdapter implements ProviderAdapter {
  readonly name = 'claude' as const;
  
  async query(message: ProviderMessage, config: ProviderQueryConfig): Promise<ProviderQueryResult> {
    const abortController = new AbortController();
    
    // Build Claude-specific options
    const options: Options = {
      ...getDefaultOptions(),
      model: config.model,
      systemPrompt: config.systemPrompt.type === 'preset' 
        ? { type: 'preset', preset: config.systemPrompt.preset!, append: config.systemPrompt.append }
        : config.systemPrompt.content!,
      cwd: config.cwd,
      mcpServers: config.mcpServers as Options['mcpServers'],
      disallowedTools: config.disallowedTools,
      maxThinkingTokens: config.maxThinkingTokens ?? 0,
      betas: config.betas as any,
      includePartialMessages: true,
      abortController,
      ...(config.sessionId ? { resume: config.sessionId } : {}),
      stderr: config.stderr,
    };
    
    // Build message content (text + attachments)
    const userContent = this.buildUserContent(message);
    
    const result: Query = query(userContent, options);
    
    return {
      events: result,
      get sessionId() { return result.sessionId; },
      get modelUsage() { return result.modelUsage; },
      abort: () => abortController.abort(),
    };
  }
  
  async isAvailable(): Promise<boolean> {
    // Check for API key or OAuth token
    return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_OAUTH_TOKEN);
  }
  
  getAvailableModels(): string[] {
    return [
      'claude-opus-4-5-20251101',
      'claude-sonnet-4-5-20250929',
      'claude-haiku-4-5-20251001',
    ];
  }
  
  mapEvent(event: unknown): AgentEvent | null {
    // Claude SDK events map 1:1 to our AgentEvent types
    // This is effectively a pass-through since our types were designed around Claude
    const sdkEvent = event as SDKMessage;
    
    switch (sdkEvent.type) {
      case 'assistant':
        if ('content' in sdkEvent && typeof sdkEvent.content === 'string') {
          return { type: 'text_delta', text: sdkEvent.content };
        }
        break;
      case 'result':
        // Handle completion - extract usage
        return null; // Handled separately via result.modelUsage
      // ... other event type mappings
    }
    
    return null;
  }
  
  getEnvironment(): Record<string, string> {
    return {}; // Env vars already set by options system
  }
  
  private buildUserContent(message: ProviderMessage): any {
    // Handle text-only vs attachments
    if (!message.attachments?.length) {
      return message.content;
    }
    
    // Build content blocks for attachments
    // (Existing logic from craft-agent.ts)
    const content: any[] = [];
    
    for (const attachment of message.attachments) {
      if (attachment.type === 'image') {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType,
            data: attachment.base64,
          },
        });
      }
      // ... other attachment types
    }
    
    content.push({ type: 'text', text: message.content });
    return content;
  }
}
```

### Task 1.3: Create Copilot Provider Adapter

**File:** `packages/shared/src/agent/providers/copilot-adapter.ts`

Create the Copilot SDK adapter (requires SDK investigation for exact API):

```typescript
import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
import type { ProviderAdapter, ProviderMessage, ProviderQueryConfig, ProviderQueryResult } from './types.ts';
import type { AgentEvent } from '@craft-agent/core/types';

export class CopilotAdapter implements ProviderAdapter {
  readonly name = 'copilot' as const;
  private client: CopilotClient | null = null;
  
  async query(message: ProviderMessage, config: ProviderQueryConfig): Promise<ProviderQueryResult> {
    // Lazy-initialize client
    if (!this.client) {
      this.client = new CopilotClient();
      await this.client.start();
    }
    
    // Create or resume session
    const session = config.sessionId 
      ? await this.client.resumeSession(config.sessionId)
      : await this.client.createSession({
          model: config.model,
          streaming: true,
          systemMessage: { content: config.systemPrompt.append || '' },
          mcpServers: this.convertMcpServers(config.mcpServers),
        });
    
    // Send message and get event stream
    const eventStream = session.sendMessage({
      content: message.content,
      // attachments: this.convertAttachments(message.attachments),
    });
    
    return {
      events: eventStream,
      sessionId: session.sessionId,
      abort: () => session.abort(),
    };
  }
  
  async isAvailable(): Promise<boolean> {
    try {
      // Check if Copilot CLI is installed and authenticated
      const { execSync } = await import('child_process');
      execSync('copilot --version', { stdio: 'pipe' });
      const authOutput = execSync('copilot auth status', { stdio: 'pipe' }).toString();
      return authOutput.includes('Logged in');
    } catch {
      return false;
    }
  }
  
  getAvailableModels(): string[] {
    return [
      'gpt-5',
      'gpt-4.1',
      'claude-sonnet-4.5',
      'claude-haiku-4.5',
    ];
  }
  
  mapEvent(event: unknown): AgentEvent | null {
    // Map Copilot SDK events to AgentEvent
    const copilotEvent = event as { type: string; [key: string]: unknown };
    
    switch (copilotEvent.type) {
      case 'assistant.message_delta':
        return { 
          type: 'text_delta', 
          text: copilotEvent.content as string 
        };
      
      case 'assistant.message':
        return { 
          type: 'text_complete', 
          text: copilotEvent.content as string 
        };
      
      case 'assistant.reasoning':
        // Copilot reasoning → our thinking display
        // May need special handling in UI
        return { 
          type: 'text_delta', 
          text: copilotEvent.content as string 
        };
      
      case 'tool.execution_start':
        return {
          type: 'tool_start',
          toolName: copilotEvent.toolName as string,
          toolUseId: copilotEvent.toolUseId as string,
          input: copilotEvent.input as Record<string, unknown>,
        };
      
      case 'tool.execution_complete':
        return {
          type: 'tool_result',
          toolUseId: copilotEvent.toolUseId as string,
          result: copilotEvent.result as string,
          isError: copilotEvent.isError as boolean ?? false,
        };
      
      case 'session.error':
        return {
          type: 'error',
          message: copilotEvent.message as string,
        };
      
      case 'session.idle':
        // Completion signal - handled by caller
        return null;
      
      default:
        return null;
    }
  }
  
  getEnvironment(): Record<string, string> {
    // Copilot uses GitHub CLI auth, no env vars needed
    return {};
  }
  
  private convertMcpServers(servers: ProviderQueryConfig['mcpServers']): any {
    // Convert our MCP server format to Copilot's expected format
    // TODO: Verify exact format required by Copilot SDK
    return servers;
  }
}
```

### Task 1.4: Provider Factory and Registry

**File:** `packages/shared/src/agent/providers/index.ts`

```typescript
import type { ProviderAdapter, ProviderType } from './types.ts';
import { ClaudeAdapter } from './claude-adapter.ts';
import { CopilotAdapter } from './copilot-adapter.ts';

export * from './types.ts';

// Singleton adapters (stateless, can be shared)
const adapters: Map<ProviderType, ProviderAdapter> = new Map();

/**
 * Get a provider adapter by type
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
        throw new Error(`Unknown provider type: ${type}`);
    }
    adapters.set(type, adapter);
  }
  
  return adapter;
}

/**
 * Check which providers are currently available
 */
export async function getAvailableProviders(): Promise<ProviderType[]> {
  const available: ProviderType[] = [];
  
  for (const [type, adapter] of adapters) {
    if (await adapter.isAvailable()) {
      available.push(type);
    }
  }
  
  // Also check un-initialized providers
  for (const type of ['claude', 'copilot'] as ProviderType[]) {
    if (!adapters.has(type)) {
      const adapter = getProviderAdapter(type);
      if (await adapter.isAvailable()) {
        available.push(type);
      }
    }
  }
  
  return [...new Set(available)];
}
```

### Task 1.5: Update CraftAgent to Use Provider Abstraction

**File:** `packages/shared/src/agent/craft-agent.ts` (modifications)

Add provider support while preserving existing Claude functionality:

```typescript
// New import
import { getProviderAdapter, type ProviderAdapter, type ProviderType } from './providers/index.ts';

// Add to CraftAgentConfig interface:
export interface CraftAgentConfig {
  // ... existing fields ...
  provider?: ProviderType;  // Default: 'claude'
}

// In CraftAgent class:
export class CraftAgent {
  // ... existing fields ...
  private providerAdapter: ProviderAdapter;
  
  constructor(config: CraftAgentConfig) {
    // ... existing initialization ...
    
    // Initialize provider adapter (default to Claude for backwards compatibility)
    const providerType = config.provider ?? 'claude';
    this.providerAdapter = getProviderAdapter(providerType);
  }
  
  // Modify chat() to use provider adapter:
  async *chat(
    userMessage: string,
    attachments?: FileAttachment[],
    _isRetry: boolean = false
  ): AsyncGenerator<AgentEvent> {
    // ... existing validation and setup code ...
    
    // Use provider adapter for query
    const queryConfig: ProviderQueryConfig = {
      model,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: getSystemPrompt(/* ... */),
      },
      cwd: this.config.session?.sdkCwd ?? /* ... */,
      mcpServers,
      disallowedTools,
      maxThinkingTokens: isClaude ? thinkingTokens : 0,
      betas: useAnthropicBetas ? ['advanced-tool-use-2025-11-20'] : undefined,
      sessionId: this.sessionId ?? undefined,
      stderr: (data) => { /* ... existing stderr handling ... */ },
    };
    
    const result = await this.providerAdapter.query(
      { content: userMessage, attachments },
      queryConfig
    );
    
    // Process events through provider's mapper
    for await (const event of result.events) {
      const mappedEvent = this.providerAdapter.mapEvent(event);
      if (mappedEvent) {
        yield mappedEvent;
      }
      
      // Also handle provider-agnostic logic (permissions, etc.)
      // ... existing event handling ...
    }
  }
}
```

### Task 1.6: Event Mapping Reference

Map Copilot SDK events to existing `AgentEvent` types (from `@craft-agent/core/types`):

| Copilot SDK Event | AgentEvent Type | Notes |
|-------------------|-----------------|-------|
| `assistant.message_delta` | `text_delta` | Streaming text chunks |
| `assistant.message` | `text_complete` | Full message |
| `assistant.reasoning` | `text_delta` | Map to thinking display (may need UI update) |
| `tool.execution_start` | `tool_start` | Include `toolName`, `toolUseId`, `input` |
| `tool.execution_complete` | `tool_result` | Include `toolUseId`, `result`, `isError` |
| `session.error` | `error` | Error message |
| `session.idle` | `complete` | Query completed |
| `user.message` | (ignored) | Echo of user message |

### Task 1.7: Phase 1 Testing Checklist

Before moving to Phase 2, verify:

- [ ] `bun run typecheck:all` passes with no errors
- [ ] `ClaudeAdapter` produces identical behavior to current implementation
- [ ] `CopilotAdapter.isAvailable()` correctly detects CLI status
- [ ] Event mapping produces valid `AgentEvent` for all event types
- [ ] Provider switching via config works correctly
- [ ] MCP servers connect successfully with both providers
- [ ] Session resumption works (if supported by Copilot SDK)

### Phase 1 File Summary

| File | Action | Description |
|------|--------|-------------|
| `packages/shared/src/agent/providers/types.ts` | Create | Provider interface definitions |
| `packages/shared/src/agent/providers/claude-adapter.ts` | Create | Claude SDK wrapper |
| `packages/shared/src/agent/providers/copilot-adapter.ts` | Create | Copilot SDK wrapper |
| `packages/shared/src/agent/providers/index.ts` | Create | Factory and exports |
| `packages/shared/src/agent/craft-agent.ts` | Modify | Add provider support |
| `packages/shared/src/agent/index.ts` | Modify | Export provider types |
| `packages/shared/package.json` | Modify | Add `@github/copilot-sdk` dependency |

---

## Phase 2: Type System Updates

**Goal:** Update types across the codebase to support the Copilot provider alongside Claude.

### Task 2.1: Add Provider Type to AuthType

**File:** `packages/core/src/types/workspace.ts`

```typescript
// Current
export type AuthType = 'api_key' | 'oauth_token';

// Updated - add copilot_cli as a new authentication method
export type AuthType = 'api_key' | 'oauth_token' | 'copilot_cli';
```

### Task 2.2: Add Copilot Credential Type

**File:** `packages/shared/src/credentials/types.ts`

Add a new credential type for Copilot CLI status tracking:

```typescript
export type CredentialType =
  // Global credentials
  | 'anthropic_api_key'  // Anthropic API key for Claude
  | 'claude_oauth'       // Claude OAuth token (Max subscription)
  | 'copilot_cli'        // NEW: GitHub Copilot CLI auth status (not stored, checked at runtime)
  // Workspace credentials
  | 'workspace_oauth'    // Workspace MCP OAuth token
  // Source credentials
  | 'source_oauth'
  | 'source_bearer'
  | 'source_apikey'
  | 'source_basic';
```

**Note:** `copilot_cli` doesn't store actual credentials - it represents the runtime auth status of the GitHub Copilot CLI which uses GitHub's own credential storage.

### Task 2.3: Update Model Definitions

**File:** `packages/shared/src/config/models.ts`

Add Copilot-available models and provider-aware helpers:

```typescript
import type { ProviderType } from '../agent/providers/types.ts';

// Existing Claude models
export const MODELS: ModelDefinition[] = [
  { id: 'claude-opus-4-5-20251101', name: 'Opus 4.5', shortName: 'Opus', description: 'Most capable', contextWindow: 200000 },
  { id: 'claude-sonnet-4-5-20250929', name: 'Sonnet 4.5', shortName: 'Sonnet', description: 'Balanced', contextWindow: 200000 },
  { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', shortName: 'Haiku', description: 'Fast & efficient', contextWindow: 200000 },
];

// NEW: Models available through GitHub Copilot
export const COPILOT_MODELS: ModelDefinition[] = [
  { id: 'gpt-5', name: 'GPT-5', shortName: 'GPT-5', description: 'OpenAI flagship', contextWindow: 128000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', shortName: 'GPT-4.1', description: 'OpenAI balanced', contextWindow: 128000 },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', shortName: 'Sonnet', description: 'Via Copilot', contextWindow: 200000 },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', shortName: 'Haiku', description: 'Fast via Copilot', contextWindow: 200000 },
];

// NEW: Default models per provider
export const DEFAULT_MODEL_BY_PROVIDER: Record<ProviderType, string> = {
  claude: 'claude-sonnet-4-5-20250929',
  copilot: 'gpt-4.1',
};

// NEW: Get models available for a specific provider
export function getModelsForProvider(provider: ProviderType): ModelDefinition[] {
  switch (provider) {
    case 'copilot':
      return COPILOT_MODELS;
    case 'claude':
    default:
      return MODELS;
  }
}

// NEW: Get default model for a provider
export function getDefaultModelForProvider(provider: ProviderType): string {
  return DEFAULT_MODEL_BY_PROVIDER[provider] ?? DEFAULT_MODEL;
}

// NEW: Check if a model belongs to a specific provider
export function isModelForProvider(modelId: string, provider: ProviderType): boolean {
  const models = getModelsForProvider(provider);
  return models.some(m => m.id === modelId);
}
```

### Task 2.4: Update StoredConfig

**File:** `packages/shared/src/config/storage.ts`

Add provider field to persisted configuration:

```typescript
import type { ProviderType } from '../agent/providers/types.ts';

export interface StoredConfig {
  authType?: AuthType;
  provider?: ProviderType;  // NEW: Active AI provider ('claude' | 'copilot')
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  activeSessionId: string | null;
  model?: string;
}

// NEW: Get the active provider
export function getProvider(): ProviderType {
  const config = loadStoredConfig();
  return config?.provider ?? 'claude';  // Default to Claude for backwards compatibility
}

// NEW: Set the active provider
export function setProvider(provider: ProviderType): void {
  const config = loadStoredConfig();
  if (!config) return;
  
  config.provider = provider;
  
  // Auto-switch to default model if current model isn't compatible with new provider
  if (config.model && !isModelForProvider(config.model, provider)) {
    config.model = getDefaultModelForProvider(provider);
  }
  
  saveConfig(config);
}
```

### Task 2.5: Update Session Types (if needed)

**File:** `packages/core/src/types/session.ts`

Sessions may need to track which provider was used:

```typescript
export interface Session {
  id: string;
  sdkSessionId?: string;
  workspaceId: string;
  name?: string;
  createdAt: number;
  lastUsedAt: number;
  provider?: ProviderType;  // NEW: Which provider created this session (for resume compatibility)
  // ... existing fields
}
```

### Phase 2 File Summary

| File | Action | Description |
| ---- | ------ | ----------- |
| `packages/core/src/types/workspace.ts` | Modify | Add `copilot_cli` to AuthType |
| `packages/shared/src/credentials/types.ts` | Modify | Add `copilot_cli` credential type |
| `packages/shared/src/config/models.ts` | Modify | Add COPILOT_MODELS and helper functions |
| `packages/shared/src/config/storage.ts` | Modify | Add provider to StoredConfig |
| `packages/core/src/types/session.ts` | Modify | Add provider field to Session |

---

## Phase 3: UI Integration

### Task 3.1: Update API Setup Options

**File:** `apps/electron/src/renderer/components/onboarding/APISetupStep.tsx`

Add third option for Copilot:

```typescript
export type ApiSetupMethod = 'api_key' | 'claude_oauth' | 'copilot_cli';

const API_SETUP_OPTIONS: ApiSetupOption[] = [
  {
    id: 'copilot_cli',
    name: 'GitHub Copilot',
    description: 'Use your existing GitHub Copilot subscription.',
    icon: <GitHubIcon className="size-4" />,
    recommended: true,
  },
  {
    id: 'claude_oauth',
    name: 'Claude Pro/Max',
    description: 'Use your Claude subscription for unlimited access.',
    icon: <CreditCard className="size-4" />,
  },
  {
    id: 'api_key',
    name: 'API Key',
    description: 'Anthropic, OpenRouter, Ollama, or compatible APIs.',
    icon: <Key className="size-4" />,
  },
];
```

### Task 3.2: Create Copilot Setup Step

**File:** `packages/ui/src/components/CopilotSetupStep.tsx`

New reusable component for Copilot authentication status:

```typescript
export type CopilotStatus = 'checking' | 'not_installed' | 'not_authenticated' | 'ready';

export interface CopilotSetupStepProps {
  status: CopilotStatus;
  onInstallClick: () => void;
  onAuthenticateClick: () => void;
  onContinue: () => void;
  onBack: () => void;
}

export function CopilotSetupStep({
  status,
  onInstallClick,
  onAuthenticateClick,
  onContinue,
  onBack,
}: CopilotSetupStepProps) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Connect GitHub Copilot</h2>
        <p className="text-muted-foreground">Use your existing Copilot subscription to power AI agents.</p>
      </div>
      
      {status === 'checking' && (
        <div className="text-muted-foreground">Checking Copilot CLI status...</div>
      )}
      
      {status === 'not_installed' && (
        <Alert>
          <p>GitHub Copilot CLI is not installed.</p>
          <Button onClick={onInstallClick}>Install Copilot CLI</Button>
        </Alert>
      )}
      
      {status === 'not_authenticated' && (
        <Alert>
          <p>Please authenticate with GitHub Copilot CLI.</p>
          <Button onClick={onAuthenticateClick}>Authenticate</Button>
        </Alert>
      )}
      
      {status === 'ready' && (
        <div className="text-green-500">✓ Copilot CLI is ready</div>
      )}
      
      <div className="flex gap-2">
        <Button variant="outline" onClick={onBack}>Back</Button>
        <Button onClick={onContinue} disabled={status !== 'ready'}>Continue</Button>
      </div>
    </div>
  );
}
```

**File:** `packages/ui/src/index.ts`

Export the new component:

```typescript
export { CopilotSetupStep, type CopilotSetupStepProps, type CopilotStatus } from './components/CopilotSetupStep';
```

### Task 3.3: Update Settings Page

**File:** `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx`

Update API Connection section to show Copilot status:

```typescript
<SettingsRow
  label="Connection type"
  description={
    authType === 'copilot_cli'
      ? 'GitHub Copilot — using your GitHub subscription'
      : authType === 'oauth_token' && hasCredential
        ? 'Claude Pro/Max — using your Claude subscription'
        : // ... existing logic
  }
>
```

### Task 3.4: Update Model Selector

**File:** `apps/electron/src/renderer/components/chat/ModelSelector.tsx`

Filter models based on active provider:

```typescript
const availableModels = useMemo(() => {
  const provider = getProvider();
  return getModelsForProvider(provider);
}, [provider]);
```

### Phase 3 File Summary

| File | Action | Description |
| ---- | ------ | ----------- |
| `apps/electron/src/renderer/components/onboarding/APISetupStep.tsx` | Modify | Add Copilot option |
| `packages/ui/src/components/CopilotSetupStep.tsx` | Create | Reusable setup component |
| `packages/ui/src/index.ts` | Modify | Export new component |
| `apps/electron/src/renderer/pages/settings/AppSettingsPage.tsx` | Modify | Show Copilot status |
| `apps/electron/src/renderer/components/chat/ModelSelector.tsx` | Modify | Filter by provider |

---

## Phase 4: Backend Integration

**Goal:** Wire up the provider abstraction to the Electron main process and IPC handlers.

### Task 4.1: Add IPC Channels for Copilot

**File:** `apps/electron/src/main/ipc.ts`

Add IPC handlers for Copilot CLI status checks:

```typescript
import { getProviderAdapter } from '@craft-agent/shared/agent/providers';

// Add to IPC_CHANNELS enum (in shared constants)
// CHECK_COPILOT_STATUS: 'check-copilot-status'
// SET_PROVIDER: 'set-provider'
// GET_PROVIDER: 'get-provider'

// Check Copilot CLI status
ipcMain.handle(IPC_CHANNELS.CHECK_COPILOT_STATUS, async () => {
  try {
    const adapter = getProviderAdapter('copilot');
    const isAvailable = await adapter.isAvailable();
    
    if (!isAvailable) {
      // Determine why - not installed vs not authenticated
      try {
        execSync('copilot --version', { stdio: 'pipe' });
        return { installed: true, authenticated: false };
      } catch {
        return { installed: false, authenticated: false };
      }
    }
    
    return { installed: true, authenticated: true };
  } catch (error) {
    return { installed: false, authenticated: false, error: String(error) };
  }
});

// Get/Set provider
ipcMain.handle(IPC_CHANNELS.GET_PROVIDER, async () => {
  return getProvider();
});

ipcMain.handle(IPC_CHANNELS.SET_PROVIDER, async (_event, provider: ProviderType) => {
  setProvider(provider);
  // Reinitialize auth for new provider
  await sessionManager.reinitializeAuth();
});
```

### Task 4.2: Update Session Manager

**File:** `apps/electron/src/main/sessions.ts`

Modify session management to use provider abstraction:

```typescript
import { getProvider, getProviderAdapter, type ProviderType } from '@craft-agent/shared';

class SessionManager {
  // ... existing fields ...
  
  async reinitializeAuth(): Promise<void> {
    const provider = getProvider();
    
    if (provider === 'copilot') {
      // Copilot uses GitHub CLI auth - no env vars to set
      // Just verify the adapter reports available
      const adapter = getProviderAdapter('copilot');
      const available = await adapter.isAvailable();
      
      if (!available) {
        sessionLog.warn('Copilot provider selected but not available');
      } else {
        sessionLog.info('Using GitHub Copilot CLI authentication');
      }
      return;
    }
    
    // Claude provider - existing auth logic
    const authState = await getAuthState();
    // ... existing Claude auth setup ...
  }
  
  async createSession(config: SessionConfig): Promise<Session> {
    const provider = getProvider();
    
    // Pass provider to CraftAgent
    const agent = new CraftAgent({
      ...config,
      provider,
    });
    
    // ... rest of session creation ...
  }
}
```

### Task 4.3: Update Preload API

**File:** `apps/electron/src/preload/index.ts`

Expose provider APIs to renderer:

```typescript
contextBridge.exposeInMainWorld('electronAPI', {
  // ... existing methods ...
  
  // Provider management
  getProvider: () => ipcRenderer.invoke(IPC_CHANNELS.GET_PROVIDER),
  setProvider: (provider: ProviderType) => ipcRenderer.invoke(IPC_CHANNELS.SET_PROVIDER, provider),
  checkCopilotStatus: () => ipcRenderer.invoke(IPC_CHANNELS.CHECK_COPILOT_STATUS),
});
```

### Phase 4 File Summary

| File | Action | Description |
| ---- | ------ | ----------- |
| `apps/electron/src/main/ipc.ts` | Modify | Add Copilot IPC handlers |
| `apps/electron/src/main/sessions.ts` | Modify | Provider-aware session creation |
| `apps/electron/src/preload/index.ts` | Modify | Expose provider APIs |
| `apps/electron/src/shared/ipc-channels.ts` | Modify | Add new IPC channel constants |

---

## Phase 5: Testing & Validation

### Task 5.0: Type Checking

Before any PR submission, ensure all types pass:

```bash
bun run typecheck:all
```

This is the **primary gate** for Phase 1 completion.

### Task 5.1: Unit Tests for Provider Adapters

**File:** `packages/shared/src/agent/providers/__tests__/claude-adapter.test.ts`

```typescript
import { ClaudeAdapter } from '../claude-adapter';

describe('ClaudeAdapter', () => {
  it('should report available when ANTHROPIC_API_KEY is set', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
    const adapter = new ClaudeAdapter();
    expect(await adapter.isAvailable()).toBe(true);
  });
  
  it('should return Claude models', () => {
    const adapter = new ClaudeAdapter();
    const models = adapter.getAvailableModels();
    expect(models).toContain('claude-sonnet-4-5-20250929');
  });
  
  it('should map SDK events to AgentEvents', () => {
    const adapter = new ClaudeAdapter();
    const event = adapter.mapEvent({ type: 'assistant', content: 'Hello' });
    expect(event).toEqual({ type: 'text_delta', text: 'Hello' });
  });
});
```

**File:** `packages/shared/src/agent/providers/__tests__/copilot-adapter.test.ts`

```typescript
import { CopilotAdapter } from '../copilot-adapter';

describe('CopilotAdapter', () => {
  it('should check CLI availability', async () => {
    const adapter = new CopilotAdapter();
    // Mock execSync for testing
    const available = await adapter.isAvailable();
    expect(typeof available).toBe('boolean');
  });
  
  it('should return Copilot models', () => {
    const adapter = new CopilotAdapter();
    const models = adapter.getAvailableModels();
    expect(models).toContain('gpt-4.1');
    expect(models).toContain('claude-sonnet-4.5');
  });
  
  it('should map Copilot events to AgentEvents', () => {
    const adapter = new CopilotAdapter();
    const event = adapter.mapEvent({ 
      type: 'assistant.message_delta', 
      content: 'Hello' 
    });
    expect(event).toEqual({ type: 'text_delta', text: 'Hello' });
  });
});
```

### Task 5.2: Integration Tests

**File:** `packages/shared/src/agent/__tests__/provider-integration.test.ts`

```typescript
describe('Provider Integration', () => {
  it('should switch providers without losing session state', async () => {
    // Test provider switching logic
  });
  
  it('should auto-select compatible model when switching providers', async () => {
    // Test model compatibility on provider switch
  });
  
  it('should handle MCP servers with both providers', async () => {
    // Test MCP server connectivity
  });
});
```

### Task 5.3: Manual Testing Checklist

**Phase 1 Completion:**

- [ ] `bun run typecheck:all` passes
- [ ] Claude adapter works identically to current implementation
- [ ] Copilot adapter compiles and type-checks
- [ ] Provider factory returns correct adapter types
- [ ] `isAvailable()` correctly detects provider status

**Full Integration (after all phases):**

- [ ] Install Copilot CLI and authenticate (`copilot auth login`)
- [ ] Select "GitHub Copilot" in onboarding flow
- [ ] Verify session creation with Copilot provider
- [ ] Test basic chat with GPT-4.1 model
- [ ] Test streaming responses
- [ ] Test tool execution (file read/write)
- [ ] Test MCP server integration
- [ ] Test model switching within provider
- [ ] Test error handling (network, auth expiry)
- [ ] Test provider switching (Copilot ↔ Claude)

---

## Phase 6: Documentation & Polish

### Task 6.1: Update README

Add section about Copilot support:

```markdown
## AI Providers

Craft Agents supports multiple AI providers:

### GitHub Copilot (Recommended)

Use your existing GitHub Copilot subscription. Requires:

- GitHub Copilot CLI installed
- Authenticated via `copilot auth login`

### Claude Pro/Max

Use your Anthropic Claude subscription via OAuth.

### API Key

Direct API access via Anthropic, OpenRouter, or Ollama.
```

### Task 6.2: Update CLAUDE.md Files

Document provider architecture for future maintainers:

**File:** `packages/shared/CLAUDE.md`

```markdown
## Provider Architecture

The agent system supports multiple AI providers through an adapter pattern:

- `providers/types.ts` - Common interfaces
- `providers/claude-adapter.ts` - Claude Agent SDK wrapper
- `providers/copilot-adapter.ts` - GitHub Copilot SDK wrapper
- `providers/index.ts` - Factory and registry

### Adding a New Provider

1. Create `providers/{name}-adapter.ts` implementing `ProviderAdapter`
2. Add to factory in `providers/index.ts`
3. Add models to `config/models.ts`
4. Update UI to show new option
```

### Task 6.3: Add User Documentation

Create help content explaining:

- How to install Copilot CLI
- How to authenticate
- Available models through Copilot
- Differences from direct Claude access

---

## Dependencies

### NPM Package

**File:** `packages/shared/package.json`

```json
{
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.2.19",
    "@github/copilot-sdk": "^0.1.19"
  }
}
```

### System Requirements

- GitHub Copilot CLI installed (`copilot --version`)
- GitHub authentication (`copilot auth login`)
- GitHub Copilot subscription (free tier or paid)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
| ---- | ------ | ---------- |
| Copilot SDK is in "Technical Preview" | API may change | Pin version, monitor releases |
| Different tool schema formats | Tools may not work | Create adapter layer for tool definitions |
| Event timing differences | UI glitches | Add buffering/debouncing as needed |
| Model availability varies | User confusion | Show only available models per provider |
| Copilot CLI not installed | Setup failure | Clear installation instructions, pre-check |
| Session resume incompatibility | Lost context | Track provider per session, warn on mismatch |

---

## Future Enhancements

1. **Auto-detect provider**: Check if Copilot CLI is available and suggest it during onboarding
2. **Hybrid mode**: Allow switching providers per-session (requires session-level provider tracking)
3. **Model recommendations**: Suggest best model for task type based on complexity
4. **Usage tracking**: Show Copilot premium request consumption in status bar
5. **BYOK support**: Leverage Copilot SDK's provider config for custom API endpoints

---

## Success Criteria

- [ ] Users can select "GitHub Copilot" during onboarding
- [ ] Sessions work equivalently with both providers
- [ ] All existing features work with Copilot provider (MCP, tools, streaming)
- [ ] Clean fallback if Copilot CLI is not available
- [ ] No regression in Claude provider functionality
- [ ] Type checking passes (`bun run typecheck:all`)

---

## Phase 1 Implementation Plan (Detailed)

This section provides step-by-step implementation guidance for Phase 1.

### Step 1: Create Provider Types (30 min)

1. Create directory: `packages/shared/src/agent/providers/`
2. Create `types.ts` with interfaces from Task 1.1
3. Run `bun run typecheck:all` to verify imports

### Step 2: Implement Claude Adapter (2 hours)

1. Create `claude-adapter.ts`
2. Extract query logic from `craft-agent.ts` into adapter methods
3. Implement `mapEvent()` for all Claude SDK event types
4. Ensure backwards compatibility - existing behavior must not change

**Key Claude SDK events to map:**

```typescript
// From @anthropic-ai/claude-agent-sdk
type SDKMessage = 
  | { type: 'init'; tools: string[]; sdkSessionId: string }
  | { type: 'assistant'; message: { content: ContentBlock[] } }
  | { type: 'user'; message: { content: ContentBlock[] } }
  | { type: 'result'; result: { inputTokens: number; outputTokens: number } }
  // ... etc
```

### Step 3: Create Copilot Adapter Stub (1 hour)

1. Create `copilot-adapter.ts`
2. Implement interface methods with TODO comments where SDK details are uncertain
3. Implement `isAvailable()` with CLI detection
4. Add placeholder event mapping

### Step 4: Create Factory (30 min)

1. Create `index.ts` with exports
2. Implement `getProviderAdapter()` factory
3. Export types for consumers

### Step 5: Integrate with CraftAgent (2 hours)

1. Add `provider` to `CraftAgentConfig`
2. Initialize adapter in constructor
3. Modify `chat()` to use adapter's `query()` method
4. Ensure all event handling still works

### Step 6: Type Check & Test (1 hour)

1. Run `bun run typecheck:all`
2. Fix any type errors
3. Test Claude provider behavior is unchanged
4. Verify Copilot adapter compiles (even if not fully functional)

### Phase 1 Estimated Time: 7-8 hours

### Phase 1 Exit Criteria

- [ ] All files created per File Summary table
- [ ] `bun run typecheck:all` passes with no errors
- [ ] Claude adapter produces same events as current implementation
- [ ] Copilot adapter stub compiles and returns `isAvailable() = false` when CLI not present
- [ ] No changes to user-visible behavior (pure refactor)

