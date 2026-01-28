# GitHub Copilot SDK Integration Plan

## Overview

Integrate the [GitHub Copilot SDK](https://github.com/github/copilot-sdk) (`@github/copilot-sdk`) as an alternative AI provider alongside the existing Claude Agent SDK. This enables users to leverage their existing GitHub Copilot subscription instead of requiring a separate Anthropic API key or Claude subscription.

## Background

### Current Architecture

Craft Agents currently uses the `@anthropic-ai/claude-agent-sdk` which:
- Spawns a CLI subprocess that communicates via JSON-RPC
- Supports Claude models exclusively (Opus, Sonnet, Haiku)
- Authenticates via Anthropic API key or Claude OAuth token
- Provides tool execution, streaming, and session management

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
| System Prompt | ✅ | ✅ (`systemMessage`) |
| Session Mgmt | ✅ | ✅ (`CopilotSession`) |

---

## Phase 1: Provider Abstraction Layer

Create an abstraction that allows the application to use either SDK interchangeably.

### Task 1.1: Define Provider Interface

**File:** `packages/shared/src/agent/providers/types.ts`

Create a common interface for AI providers:

```typescript
export interface AIProvider {
  name: string;
  
  // Session lifecycle
  createSession(config: ProviderSessionConfig): Promise<ProviderSession>;
  destroySession(sessionId: string): Promise<void>;
  
  // Messaging
  sendMessage(sessionId: string, message: string, attachments?: FileAttachment[]): AsyncGenerator<ProviderEvent>;
  abortMessage(sessionId: string): Promise<void>;
  
  // Status
  isAvailable(): Promise<boolean>;
  getAvailableModels(): Promise<ProviderModel[]>;
}

export interface ProviderSession {
  id: string;
  model: string;
}

export interface ProviderEvent {
  type: 'assistant' | 'tool_start' | 'tool_end' | 'error' | 'idle' | 'thinking';
  data: unknown;
}

export interface ProviderModel {
  id: string;
  name: string;
  provider: 'anthropic' | 'openai' | 'copilot';
}
```

### Task 1.2: Wrap Claude SDK in Provider

**File:** `packages/shared/src/agent/providers/claude-provider.ts`

Refactor existing `craft-agent.ts` logic into a provider class:

- Extract the `query()` usage into `ClaudeProvider.sendMessage()`
- Map SDK events to `ProviderEvent` types
- Handle OAuth token and API key authentication
- Preserve all existing Claude-specific features (thinking tokens, betas, etc.)

### Task 1.3: Implement Copilot Provider

**File:** `packages/shared/src/agent/providers/copilot-provider.ts`

Create new provider using `@github/copilot-sdk`:

```typescript
import { CopilotClient, CopilotSession, SessionEvent } from '@github/copilot-sdk';

export class CopilotProvider implements AIProvider {
  private client: CopilotClient | null = null;
  private sessions: Map<string, CopilotSession> = new Map();
  
  async createSession(config: ProviderSessionConfig): Promise<ProviderSession> {
    if (!this.client) {
      this.client = new CopilotClient();
      await this.client.start();
    }
    
    const session = await this.client.createSession({
      model: config.model,
      streaming: true,
      systemMessage: { content: config.systemPrompt },
      mcpServers: config.mcpServers,
      tools: config.tools,
    });
    
    this.sessions.set(session.sessionId, session);
    return { id: session.sessionId, model: config.model };
  }
  
  async *sendMessage(sessionId: string, message: string): AsyncGenerator<ProviderEvent> {
    const session = this.sessions.get(sessionId);
    // ... event mapping logic
  }
}
```

### Task 1.4: Event Mapping

Map Copilot SDK events to existing `AgentEvent` types:

| Copilot Event | AgentEvent Type |
|---------------|-----------------|
| `assistant.message` | `assistant` |
| `assistant.message_delta` | `assistant` (streaming) |
| `assistant.reasoning` | `thinking` |
| `tool.execution_start` | `tool_start` |
| `tool.execution_complete` | `tool_end` |
| `session.error` | `error` |
| `session.idle` | (completion signal) |
| `user.message` | `user` |

### Task 1.5: Provider Factory

**File:** `packages/shared/src/agent/providers/index.ts`

```typescript
export function createProvider(type: ProviderType): AIProvider {
  switch (type) {
    case 'claude':
      return new ClaudeProvider();
    case 'copilot':
      return new CopilotProvider();
    default:
      throw new Error(`Unknown provider: ${type}`);
  }
}
```

---

## Phase 2: Type System Updates

### Task 2.1: Add New Auth Type

**File:** `packages/core/src/types/workspace.ts`

```typescript
// Current
export type AuthType = 'api_key' | 'oauth_token';

// Updated
export type AuthType = 'api_key' | 'oauth_token' | 'copilot_cli';
```

### Task 2.2: Add Copilot Credential Type

**File:** `packages/shared/src/credentials/types.ts`

```typescript
export type CredentialType =
  | 'anthropic_api_key'
  | 'claude_oauth'
  | 'copilot_cli'  // New - represents GitHub CLI auth status
  | 'source_oauth'
  // ... existing types
```

### Task 2.3: Update Model Definitions

**File:** `packages/shared/src/config/models.ts`

Add Copilot-available models:

```typescript
export const COPILOT_MODELS: ModelDefinition[] = [
  { id: 'gpt-5', name: 'GPT-5', shortName: 'GPT-5', description: 'OpenAI flagship', contextWindow: 128000 },
  { id: 'gpt-4.1', name: 'GPT-4.1', shortName: 'GPT-4.1', description: 'OpenAI balanced', contextWindow: 128000 },
  { id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', shortName: 'Sonnet', description: 'Anthropic via Copilot', contextWindow: 200000 },
  { id: 'claude-haiku-4.5', name: 'Claude Haiku 4.5', shortName: 'Haiku', description: 'Fast & efficient', contextWindow: 200000 },
];

export function getModelsForProvider(provider: 'claude' | 'copilot'): ModelDefinition[] {
  return provider === 'copilot' ? COPILOT_MODELS : MODELS;
}
```

### Task 2.4: Update StoredConfig

**File:** `packages/shared/src/config/storage.ts`

```typescript
export interface StoredConfig {
  authType?: AuthType;
  provider?: 'claude' | 'copilot';  // New field
  // ... existing fields
}

export function getProvider(): 'claude' | 'copilot' {
  const config = loadStoredConfig();
  return config?.provider ?? 'claude';
}

export function setProvider(provider: 'claude' | 'copilot'): void {
  const config = loadStoredConfig();
  if (!config) return;
  config.provider = provider;
  saveConfig(config);
}
```

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

**File:** `apps/electron/src/renderer/components/onboarding/CopilotSetupStep.tsx`

New component for Copilot authentication:

```typescript
export function CopilotSetupStep({ onContinue, onBack }: CopilotSetupStepProps) {
  const [status, setStatus] = useState<'checking' | 'not_installed' | 'not_authenticated' | 'ready'>('checking');
  
  // Check if Copilot CLI is installed and authenticated
  useEffect(() => {
    window.electronAPI.checkCopilotCli().then(result => {
      if (!result.installed) setStatus('not_installed');
      else if (!result.authenticated) setStatus('not_authenticated');
      else setStatus('ready');
    });
  }, []);
  
  return (
    <StepFormLayout
      title="Connect GitHub Copilot"
      description="Use your existing Copilot subscription to power AI agents."
    >
      {status === 'not_installed' && (
        <Alert>
          <p>GitHub Copilot CLI is not installed.</p>
          <Button onClick={() => shell.openExternal('https://docs.github.com/en/copilot/...')}>
            Install Copilot CLI
          </Button>
        </Alert>
      )}
      {status === 'not_authenticated' && (
        <Alert>
          <p>Please authenticate with GitHub Copilot CLI.</p>
          <Button onClick={() => window.electronAPI.runCopilotAuth()}>
            Run `gh auth login`
          </Button>
        </Alert>
      )}
      {status === 'ready' && (
        <div className="text-green-500">✓ Copilot CLI is ready</div>
      )}
    </StepFormLayout>
  );
}
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

---

## Phase 4: Backend Integration

### Task 4.1: Add IPC Handlers

**File:** `apps/electron/src/main/ipc.ts`

```typescript
// Check Copilot CLI status
ipcMain.handle(IPC_CHANNELS.CHECK_COPILOT_CLI, async () => {
  try {
    // Check if copilot command exists
    const { stdout } = await execAsync('copilot --version');
    
    // Check if authenticated
    const { stdout: authStatus } = await execAsync('copilot auth status');
    const authenticated = authStatus.includes('Logged in');
    
    return { installed: true, authenticated, version: stdout.trim() };
  } catch {
    return { installed: false, authenticated: false };
  }
});

// Get available Copilot models
ipcMain.handle(IPC_CHANNELS.GET_COPILOT_MODELS, async () => {
  // Use CopilotClient.getModels() once implemented
  return COPILOT_MODELS;
});
```

### Task 4.2: Update Session Manager

**File:** `apps/electron/src/main/sessions.ts`

Add Copilot provider initialization:

```typescript
async reinitializeAuth(): Promise<void> {
  const authState = await getAuthState();
  const provider = getProvider();
  
  if (provider === 'copilot') {
    // Copilot uses GitHub CLI auth, no env vars needed
    sessionLog.info('Using GitHub Copilot CLI authentication');
    return;
  }
  
  // ... existing Claude auth logic
}

private async createProviderForSession(): Promise<AIProvider> {
  const provider = getProvider();
  return createProvider(provider);
}
```

### Task 4.3: Update CraftAgent

**File:** `packages/shared/src/agent/craft-agent.ts`

Modify to use provider abstraction:

```typescript
export class CraftAgent {
  private provider: AIProvider;
  
  constructor(config: AgentConfig) {
    const providerType = config.provider ?? 'claude';
    this.provider = createProvider(providerType);
  }
  
  async *chat(userMessage: string, attachments?: FileAttachment[]): AsyncGenerator<AgentEvent> {
    // Use provider abstraction instead of direct SDK calls
    for await (const event of this.provider.sendMessage(this.sessionId, userMessage, attachments)) {
      yield this.mapProviderEventToAgentEvent(event);
    }
  }
}
```

---

## Phase 5: Testing & Validation

### Task 5.1: Add Copilot Provider Tests

**File:** `packages/shared/tests/copilot-provider.test.ts`

```typescript
describe('CopilotProvider', () => {
  it('creates session with correct config', async () => { });
  it('maps events correctly', async () => { });
  it('handles tool execution', async () => { });
  it('supports streaming', async () => { });
});
```

### Task 5.2: Add Integration Tests

- Test switching between providers
- Test model selection per provider
- Test MCP server connectivity with Copilot
- Test custom tools with Copilot SDK

### Task 5.3: Manual Testing Checklist

- [ ] Install Copilot CLI and authenticate
- [ ] Select "GitHub Copilot" in onboarding
- [ ] Verify session creation
- [ ] Test basic chat
- [ ] Test streaming responses
- [ ] Test tool execution (file operations)
- [ ] Test MCP server integration
- [ ] Test model switching
- [ ] Test error handling
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
- Authenticated via `gh auth login`

### Claude Pro/Max
Use your Anthropic Claude subscription via OAuth.

### API Key
Direct API access via Anthropic, OpenRouter, or Ollama.
```

### Task 6.2: Update CLAUDE.md Files

Document provider architecture for future maintainers.

### Task 6.3: Add User Documentation

Create help content explaining:
- How to install Copilot CLI
- How to authenticate
- Available models through Copilot
- Differences from direct Claude access

---

## Dependencies

### NPM Package

```json
{
  "dependencies": {
    "@github/copilot-sdk": "^0.1.19"
  }
}
```

### System Requirements

- GitHub Copilot CLI installed (`copilot --version`)
- GitHub authentication (`gh auth login`)
- GitHub Copilot subscription (free tier or paid)

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Copilot SDK is in "Technical Preview" | API may change | Pin version, monitor releases |
| Different tool schema formats | Tools may not work | Create adapter layer for tool definitions |
| Event timing differences | UI glitches | Add buffering/debouncing as needed |
| Model availability varies | User confusion | Show only available models per provider |
| Copilot CLI not installed | Setup failure | Clear installation instructions, pre-check |

---

## Future Enhancements

1. **Auto-detect provider**: Check if Copilot CLI is available and suggest it
2. **Hybrid mode**: Allow switching providers per-session
3. **Model recommendations**: Suggest best model for task type
4. **Usage tracking**: Show Copilot premium request consumption
5. **BYOK support**: Leverage Copilot SDK's provider config for custom APIs

---

## Success Criteria

- [ ] Users can select "GitHub Copilot" during onboarding
- [ ] Sessions work equivalently with both providers
- [ ] All existing features work with Copilot provider
- [ ] Clean fallback if Copilot CLI is not available
- [ ] No regression in Claude provider functionality
