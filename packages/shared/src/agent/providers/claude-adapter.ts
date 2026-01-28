/**
 * Claude Provider Adapter
 * Wraps the @anthropic-ai/claude-agent-sdk for the provider abstraction layer.
 * This adapter preserves all existing Claude SDK functionality while conforming
 * to the ProviderAdapter interface.
 */

import { query, type Query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ProviderAdapter, ProviderMessage, ProviderQueryConfig, ProviderQueryResult } from "./types.ts";
import { getDefaultOptions } from "../options.ts";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources";

/**
 * Claude SDK adapter implementing the ProviderAdapter interface.
 * This is a thin wrapper that preserves all existing Claude SDK behavior
 * while allowing CraftAgent to work with multiple providers.
 *
 * Note: The Claude SDK's Query object is an AsyncIterable that yields SDK messages.
 * Session ID and usage data are extracted from these messages during iteration,
 * not from the Query object itself. This is why the adapter returns the raw
 * AsyncIterable and CraftAgent handles all event processing.
 */
export class ClaudeAdapter implements ProviderAdapter {
  readonly name = "claude" as const;

  /**
   * Execute a query using the Claude Agent SDK.
   * Returns an event stream that can be iterated to receive SDK messages.
   *
   * Note: Session ID and model usage are extracted from messages during iteration
   * by CraftAgent, not from the returned Query object.
   */
  async query(message: ProviderMessage, config: ProviderQueryConfig): Promise<ProviderQueryResult> {
    const abortController = config.abortController ?? new AbortController();

    // Build system prompt - for Claude, preset must be 'claude_code' literal
    const systemPrompt =
      config.systemPrompt.type === "preset"
        ? {
            type: "preset" as const,
            preset: "claude_code" as const,
            append: config.systemPrompt.append,
          }
        : config.systemPrompt.content!;

    // Build Claude-specific options
    const options: Options = {
      ...getDefaultOptions(),
      model: config.model,
      systemPrompt,
      cwd: config.cwd,
      mcpServers: config.mcpServers as Options["mcpServers"],
      disallowedTools: config.disallowedTools,
      maxThinkingTokens: config.maxThinkingTokens ?? 0,
      includePartialMessages: config.includePartialMessages ?? true,
      abortController,
      ...(config.sessionId ? { resume: config.sessionId } : {}),
      ...(config.stderr ? { stderr: config.stderr } : {}),
      ...(config.betas ? { betas: config.betas as any } : {}),
      ...(config.permissionMode ? { permissionMode: config.permissionMode } : {}),
      ...(config.allowDangerouslySkipPermissions !== undefined ? { allowDangerouslySkipPermissions: config.allowDangerouslySkipPermissions } : {}),
      ...(config.hooks ? { hooks: config.hooks as Options["hooks"] } : {}),
      // Tools config - Claude SDK requires preset to be literal 'claude_code'
      tools: { type: "preset" as const, preset: "claude_code" as const },
      ...(config.workspaceRootPath ? { plugins: [{ type: "local" as const, path: config.workspaceRootPath }] } : {}),
    };

    // Execute query based on message type
    let result: Query;

    // Check if we have binary attachments that need the AsyncIterable interface
    const hasBinaryAttachments = message.attachments?.some((a) => a.type === "image" || a.type === "pdf");

    if (hasBinaryAttachments) {
      // Build SDK user message with content blocks for binary attachments
      const sdkMessage = this.buildSDKUserMessage(message);
      async function* singleMessage(): AsyncIterable<SDKUserMessage> {
        yield sdkMessage;
      }
      result = query({ prompt: singleMessage(), options });
    } else {
      // Simple string prompt for text-only messages
      result = query({ prompt: message.content, options });
    }

    // The Claude SDK Query is an AsyncIterable - session ID and usage data
    // are extracted from messages during iteration, not from properties.
    // CraftAgent handles this in its message processing loop.
    return {
      events: result,
      // Session ID is captured from messages with 'session_id' field
      sessionId: undefined,
      // Model usage is captured from 'result' type messages
      modelUsage: undefined,
      abort: () => abortController.abort(),
    };
  }

  /**
   * Check if Claude provider is available.
   * Requires either ANTHROPIC_API_KEY or CLAUDE_OAUTH_TOKEN environment variable.
   */
  async isAvailable(): Promise<boolean> {
    return !!(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_OAUTH_TOKEN);
  }

  /**
   * Get list of Claude models available through this provider.
   */
  getAvailableModels(): string[] {
    return ["claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929", "claude-haiku-4-5-20251001"];
  }

  /**
   * Map Claude SDK event to AgentEvent.
   * Note: For Claude, this is a pass-through since our AgentEvent types
   * were originally designed around the Claude SDK message format.
   * The actual event mapping happens in CraftAgent.convertSDKMessage()
   * which handles all the complex logic for tool tracking, parent-child
   * relationships, etc.
   *
   * This method is provided for interface compliance but the actual
   * mapping is done by CraftAgent to maintain all existing behavior.
   */
  mapEvent(_event: unknown): null {
    // Claude events are handled directly by CraftAgent.convertSDKMessage()
    // which contains complex logic for tool tracking, session management, etc.
    // This method returns null to indicate CraftAgent should use its own mapping.
    return null;
  }

  /**
   * Get environment variables needed for Claude.
   * Returns empty since env vars are already configured by the credentials system.
   */
  getEnvironment(): Record<string, string> {
    return {};
  }

  /**
   * Build an SDK user message with proper content blocks for binary attachments.
   */
  private buildSDKUserMessage(message: ProviderMessage): SDKUserMessage {
    const contentBlocks: ContentBlockParam[] = [];

    // Add attachments as content blocks
    if (message.attachments) {
      for (const attachment of message.attachments) {
        // Add path info text block
        if (attachment.storedPath) {
          let pathInfo = `[Attached file: ${attachment.name}]\n[Stored at: ${attachment.storedPath}]`;
          if (attachment.markdownPath) {
            pathInfo += `\n[Markdown version: ${attachment.markdownPath}]`;
          }
          contentBlocks.push({
            type: "text",
            text: pathInfo,
          });
        }

        // Only images and PDFs are uploaded inline
        if (attachment.type === "image" && attachment.base64) {
          const mediaType = this.mapImageMediaType(attachment.mimeType);
          if (mediaType) {
            contentBlocks.push({
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType,
                data: attachment.base64,
              },
            });
          }
        } else if (attachment.type === "pdf" && attachment.base64) {
          contentBlocks.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: attachment.base64,
            },
          });
        }
      }
    }

    // Add user's text message
    if (message.content.trim()) {
      contentBlocks.push({ type: "text", text: message.content });
    }

    return {
      type: "user",
      message: {
        role: "user",
        content: contentBlocks,
      },
      parent_tool_use_id: null,
      session_id: "",
    } as SDKUserMessage;
  }

  /**
   * Map file MIME types to SDK-supported image types.
   */
  private mapImageMediaType(mimeType?: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | null {
    if (!mimeType) return null;
    const supported: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
      "image/jpeg": "image/jpeg",
      "image/png": "image/png",
      "image/gif": "image/gif",
      "image/webp": "image/webp",
    };
    return supported[mimeType] || null;
  }
}
