/**
 * Copilot Provider Adapter (Stub)
 * 
 * This adapter wraps the GitHub Copilot SDK (@github/copilot-sdk) for the provider
 * abstraction layer. It enables users to leverage their existing GitHub Copilot
 * subscription as an alternative to the Claude Agent SDK.
 * 
 * NOTE: This is a Phase 1 stub implementation. The actual SDK integration will be
 * completed when the full Copilot SDK API is finalized. The adapter compiles and
 * passes type checks, but query() is not yet fully functional.
 * 
 * Status: Technical Preview - API may change based on Copilot SDK evolution.
 */

import { execSync } from 'child_process';
import type {
  ProviderAdapter,
  ProviderMessage,
  ProviderQueryConfig,
  ProviderQueryResult,
} from './types.ts';
import type { AgentEvent } from '@craft-agent/core/types';
import { debug } from '../../utils/debug.ts';

// Copilot SDK types - will be imported from @github/copilot-sdk when available
// For now, define stub types for compilation
interface CopilotEvent {
  type: string;
  content?: string;
  toolName?: string;
  toolUseId?: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
  message?: string;
}

/**
 * Copilot SDK adapter implementing the ProviderAdapter interface.
 * 
 * The Copilot SDK has a similar architecture to the Claude Agent SDK:
 * - JSON-RPC communication with a CLI subprocess
 * - Streaming support
 * - MCP server integration
 * - Tool execution
 * 
 * Key differences:
 * - Supports multiple models (GPT-5, GPT-4.1, Claude Sonnet/Haiku via Copilot)
 * - Uses GitHub CLI authentication (not API key)
 * - Different event format (requires mapping to AgentEvent)
 */
export class CopilotAdapter implements ProviderAdapter {
  readonly name = 'copilot' as const;
  
  /**
   * Execute a query using the Copilot SDK.
   * 
   * NOTE: This is a stub implementation. The actual SDK integration will be
   * completed when the Copilot SDK API is finalized.
   */
  async query(
    message: ProviderMessage,
    config: ProviderQueryConfig
  ): Promise<ProviderQueryResult> {
    // Log the attempt for debugging
    debug('[CopilotAdapter] query() called - stub implementation');
    debug(`[CopilotAdapter] model: ${config.model}, message length: ${message.content.length}`);
    
    // Create abort controller for cancellation
    const abortController = config.abortController ?? new AbortController();
    
    // TODO: Implement actual Copilot SDK integration
    // The integration will follow this pattern:
    //
    // 1. Initialize CopilotClient if not already done
    // 2. Create or resume session with model and system prompt
    // 3. Send message and return event stream
    //
    // Example (pseudocode based on expected SDK API):
    //
    // import { CopilotClient, CopilotSession } from '@github/copilot-sdk';
    //
    // if (!this.client) {
    //   this.client = new CopilotClient();
    //   await this.client.start();
    // }
    //
    // const session = config.sessionId 
    //   ? await this.client.resumeSession(config.sessionId)
    //   : await this.client.createSession({
    //       model: config.model,
    //       streaming: true,
    //       systemMessage: { content: config.systemPrompt.append || '' },
    //       mcpServers: this.convertMcpServers(config.mcpServers),
    //     });
    //
    // const eventStream = session.sendMessage({
    //   content: message.content,
    // });
    //
    // return {
    //   events: eventStream,
    //   sessionId: session.sessionId,
    //   abort: () => session.abort(),
    // };
    
    // For now, return a stub that yields an error event
    const stubEvents = this.createStubEventStream();
    
    return {
      events: stubEvents,
      sessionId: undefined,
      modelUsage: undefined,
      abort: () => abortController.abort(),
    };
  }
  
  /**
   * Create a stub event stream that yields an informational message.
   * This is used until the actual Copilot SDK integration is complete.
   */
  private async *createStubEventStream(): AsyncIterable<CopilotEvent> {
    yield {
      type: 'assistant.message',
      content: 'Copilot SDK integration is not yet complete. Please use the Claude provider for now.',
    };
    yield {
      type: 'session.idle',
    };
  }
  
  /**
   * Check if Copilot CLI is installed and authenticated.
   * 
   * The Copilot CLI uses GitHub authentication, so we check:
   * 1. Is the 'copilot' CLI installed and accessible?
   * 2. Is the user authenticated with GitHub?
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if Copilot CLI is installed
      execSync('copilot --version', { stdio: 'pipe' });
      
      // Check if user is authenticated
      const authOutput = execSync('copilot auth status', { stdio: 'pipe' }).toString();
      const isAuthenticated = authOutput.toLowerCase().includes('logged in');
      
      debug(`[CopilotAdapter] isAvailable: CLI found, authenticated=${isAuthenticated}`);
      return isAuthenticated;
    } catch (error) {
      // CLI not installed or not in PATH
      debug(`[CopilotAdapter] isAvailable: false (${error instanceof Error ? error.message : 'unknown error'})`);
      return false;
    }
  }
  
  /**
   * Get list of models available through GitHub Copilot.
   * 
   * Copilot provides access to multiple models including:
   * - OpenAI models (GPT-5, GPT-4.1)
   * - Anthropic models via Copilot (Claude Sonnet 4.5, Claude Haiku 4.5)
   */
  getAvailableModels(): string[] {
    return [
      'gpt-5',
      'gpt-4.1',
      'claude-sonnet-4.5',
      'claude-haiku-4.5',
    ];
  }
  
  /**
   * Map Copilot SDK event to AgentEvent.
   * 
   * The Copilot SDK has a different event format that needs to be mapped
   * to our internal AgentEvent types for consistent UI rendering.
   */
  mapEvent(event: unknown): AgentEvent | null {
    const copilotEvent = event as CopilotEvent;
    
    switch (copilotEvent.type) {
      case 'assistant.message_delta':
        return { 
          type: 'text_delta', 
          text: copilotEvent.content || '' 
        };
      
      case 'assistant.message':
        return { 
          type: 'text_complete', 
          text: copilotEvent.content || '',
          isIntermediate: false,
        };
      
      case 'assistant.reasoning':
        // Map Copilot reasoning to text_delta for thinking display
        return { 
          type: 'text_delta', 
          text: copilotEvent.content || '' 
        };
      
      case 'tool.execution_start':
        return {
          type: 'tool_start',
          toolName: copilotEvent.toolName || 'unknown',
          toolUseId: copilotEvent.toolUseId || `tool-${Date.now()}`,
          input: copilotEvent.input || {},
        };
      
      case 'tool.execution_complete':
        return {
          type: 'tool_result',
          toolUseId: copilotEvent.toolUseId || '',
          result: copilotEvent.result || '',
          isError: copilotEvent.isError ?? false,
        };
      
      case 'session.error':
        return {
          type: 'error',
          message: copilotEvent.message || 'Unknown Copilot error',
        };
      
      case 'session.idle':
        // Completion signal
        return {
          type: 'complete',
        };
      
      default:
        // Unknown event type - skip
        debug(`[CopilotAdapter] Unknown event type: ${copilotEvent.type}`);
        return null;
    }
  }
  
  /**
   * Get environment variables needed for Copilot.
   * 
   * Copilot uses GitHub CLI authentication which stores credentials
   * in the system keychain, so no environment variables are needed.
   */
  getEnvironment(): Record<string, string> {
    return {};
  }
  
  /**
   * Convert MCP server config to Copilot SDK format.
   * TODO: Implement when Copilot SDK API is finalized.
   */
  private convertMcpServers(_servers: ProviderQueryConfig['mcpServers']): unknown {
    // Copilot SDK may have a different MCP server config format
    // For now, return as-is (may need transformation later)
    return _servers;
  }
}
