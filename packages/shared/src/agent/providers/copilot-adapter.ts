/**
 * Copilot Provider Adapter
 *
 * This adapter interfaces with the GitHub Copilot CLI (`copilot`) to enable users
 * to leverage their existing GitHub Copilot subscription as an alternative to
 * the Claude Agent SDK.
 *
 * Architecture:
 * - Spawns the `copilot` CLI as a subprocess with `-p` (prompt) flag
 * - Uses `--stream on` for streaming responses
 * - Uses `--silent` for clean output without stats
 * - Uses `--allow-all-tools` for automatic tool execution
 * - Parses streaming output and converts to AgentEvent format
 *
 * Supported models (via --model flag):
 * - claude-sonnet-4.5, claude-haiku-4.5, claude-opus-4.5
 * - gpt-5, gpt-5.2, gpt-4.1
 * - gemini-3-pro-preview
 */

import { spawn, execSync, type ChildProcess } from "child_process";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir, tmpdir } from "os";
import type { ProviderAdapter, ProviderMessage, ProviderQueryConfig, ProviderQueryResult } from "./types.ts";
import type { AgentEvent } from "@craft-agent/core/types";
import { debug } from "../../utils/debug.ts";

/**
 * Internal event type for Copilot CLI output parsing
 */
interface CopilotStreamEvent {
  type: "text" | "tool_start" | "tool_result" | "error" | "complete" | "thinking";
  content?: string;
  toolName?: string;
  toolUseId?: string;
  input?: Record<string, unknown>;
  result?: string;
  isError?: boolean;
}

/**
 * Map internal model IDs to Copilot CLI model names.
 * The Copilot CLI uses simplified model names (e.g., "claude-opus-4.5")
 * while the app may use full version IDs (e.g., "claude-opus-4-5-20251101").
 */
const MODEL_ID_TO_COPILOT: Record<string, string> = {
  // Claude models - map dated versions to simple names
  "claude-opus-4-5-20251101": "claude-opus-4.5",
  "claude-sonnet-4-5-20251101": "claude-sonnet-4.5",
  "claude-haiku-4-5-20251101": "claude-haiku-4.5",
  "claude-sonnet-4-20250514": "claude-sonnet-4",
  // Already correct format (passthrough)
  "claude-opus-4.5": "claude-opus-4.5",
  "claude-sonnet-4.5": "claude-sonnet-4.5",
  "claude-haiku-4.5": "claude-haiku-4.5",
  "claude-sonnet-4": "claude-sonnet-4",
  // GPT models
  "gpt-5": "gpt-5",
  "gpt-5.2": "gpt-5.2",
  "gpt-5.1": "gpt-5.1",
  "gpt-5-mini": "gpt-5-mini",
  "gpt-4.1": "gpt-4.1",
  "gpt-5.2-codex": "gpt-5.2-codex",
  "gpt-5.1-codex": "gpt-5.1-codex",
  "gpt-5.1-codex-max": "gpt-5.1-codex-max",
  "gpt-5.1-codex-mini": "gpt-5.1-codex-mini",
  // Gemini models
  "gemini-3-pro-preview": "gemini-3-pro-preview",
};

/**
 * Convert an internal model ID to the Copilot CLI format.
 * Falls back to extracting a simplified name if not in the mapping.
 */
function toCopilotModelId(modelId: string): string {
  // Check direct mapping first
  if (MODEL_ID_TO_COPILOT[modelId]) {
    return MODEL_ID_TO_COPILOT[modelId];
  }

  // Try to extract a simplified model name from dated format
  // e.g., "claude-opus-4-5-20251101" -> "claude-opus-4.5"
  const claudeMatch = modelId.match(/^(claude-(?:opus|sonnet|haiku))-(\d+)-(\d+)-\d+$/);
  if (claudeMatch) {
    const [, prefix, major, minor] = claudeMatch;
    return `${prefix}-${major}.${minor}`;
  }

  // Return as-is and let the CLI validate
  debug(`[CopilotAdapter] Unknown model ID format: ${modelId}, passing through`);
  return modelId;
}

/**
 * Copilot CLI adapter implementing the ProviderAdapter interface.
 *
 * Uses the GitHub Copilot CLI in non-interactive mode (`-p` flag) to execute
 * queries. The CLI handles:
 * - Authentication via GitHub CLI credentials
 * - Model selection
 * - Tool execution (file read/write, shell commands)
 * - MCP server integration
 */
export class CopilotAdapter implements ProviderAdapter {
  readonly name = "copilot" as const;

  // Path to copilot CLI (cached after first lookup)
  private copilotPath: string | null = null;

  /**
   * Execute a query using the Copilot CLI subprocess.
   *
   * Spawns `copilot -p "message" --model <model> --allow-all-tools --stream on --silent`
   * and parses the streaming output into AgentEvents.
   */
  async query(message: ProviderMessage, config: ProviderQueryConfig): Promise<ProviderQueryResult> {
    debug("[CopilotAdapter] query() called");
    debug(`[CopilotAdapter] model: ${config.model}, message length: ${message.content.length}`);

    // Find copilot CLI path
    const copilotPath = this.findCopilotCli();
    if (!copilotPath) {
      throw new Error("Copilot CLI not found. Please install GitHub Copilot CLI.");
    }

    // Create abort controller
    const abortController = config.abortController ?? new AbortController();
    let childProcess: ChildProcess | null = null;

    // Build CLI arguments
    const args = this.buildCliArgs(message, config);
    debug(`[CopilotAdapter] CLI args: ${args.join(" ")}`);

    // Create the event stream generator
    const eventStream = this.createEventStream(copilotPath, args, abortController, (proc) => {
      childProcess = proc;
    });

    return {
      events: eventStream,
      get sessionId() {
        return undefined; // Copilot CLI doesn't expose session ID in output
      },
      modelUsage: undefined, // Copilot CLI doesn't expose usage in silent mode
      abort: () => {
        debug("[CopilotAdapter] Aborting query");
        abortController.abort();
        if (childProcess) {
          childProcess.kill("SIGTERM");
        }
      },
    };
  }

  /**
   * Find the copilot CLI executable path.
   * Checks common installation locations.
   */
  private findCopilotCli(): string | null {
    if (this.copilotPath) {
      return this.copilotPath;
    }

    // Common paths to check
    const paths = [
      // Homebrew (macOS)
      "/opt/homebrew/bin/copilot",
      "/usr/local/bin/copilot",
      // VS Code extension path (macOS)
      join(homedir(), "Library", "Application Support", "Code", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot"),
      // VS Code Insiders
      join(homedir(), "Library", "Application Support", "Code - Insiders", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot"),
      // Cursor
      join(homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot"),
      // Linux VS Code
      join(homedir(), ".config", "Code", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot"),
      // Windows
      join(homedir(), "AppData", "Roaming", "Code", "User", "globalStorage", "github.copilot-chat", "copilotCli", "copilot.exe"),
    ];

    for (const path of paths) {
      if (existsSync(path)) {
        this.copilotPath = path;
        debug(`[CopilotAdapter] Found copilot CLI at: ${path}`);
        return path;
      }
    }

    // Try to find in PATH
    try {
      const which = process.platform === "win32" ? "where" : "which";
      const result = execSync(`${which} copilot`, { stdio: "pipe", encoding: "utf-8" }).trim();
      if (result) {
        this.copilotPath = result.split("\n")[0] ?? null; // Take first result on Windows
        debug(`[CopilotAdapter] Found copilot CLI in PATH: ${this.copilotPath}`);
        return this.copilotPath;
      }
    } catch {
      // Not in PATH
    }

    debug("[CopilotAdapter] Copilot CLI not found");
    return null;
  }

  /**
   * Build CLI arguments for the copilot command.
   */
  private buildCliArgs(message: ProviderMessage, config: ProviderQueryConfig): string[] {
    const args: string[] = [];

    // Prompt (the user message)
    args.push("-p", message.content);

    // Model selection - convert to Copilot CLI format
    const copilotModel = toCopilotModelId(config.model);
    args.push("--model", copilotModel);

    // Enable streaming
    args.push("--stream", "on");

    // Silent mode (output only response, no stats)
    args.push("--silent");

    // No color for clean parsing
    args.push("--no-color");

    // Auto-approve all tools for non-interactive mode
    args.push("--allow-all-tools");
    args.push("--allow-all-paths");

    // Set working directory
    if (config.cwd) {
      args.push("--add-dir", config.cwd);
    }

    // Add MCP server config if provided
    if (config.mcpServers && Object.keys(config.mcpServers).length > 0) {
      const mcpConfig = this.convertMcpServers(config.mcpServers);
      if (mcpConfig) {
        // Write MCP config to temp file and pass via --additional-mcp-config
        const tempPath = this.writeTempMcpConfig(mcpConfig);
        args.push("--additional-mcp-config", `@${tempPath}`);
      }
    }

    // Resume session if session ID provided
    if (config.sessionId) {
      args.push("--resume", config.sessionId);
    }

    // Disable tools if specified
    if (config.disallowedTools && config.disallowedTools.length > 0) {
      for (const tool of config.disallowedTools) {
        args.push("--deny-tool", tool);
      }
    }

    return args;
  }

  /**
   * Create an async generator that spawns the copilot CLI and yields events.
   */
  private async *createEventStream(copilotPath: string, args: string[], abortController: AbortController, onProcess: (proc: ChildProcess) => void): AsyncIterable<CopilotStreamEvent> {
    debug(`[CopilotAdapter] Spawning: ${copilotPath} ${args.join(" ")}`);

    const proc = spawn(copilotPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensure color is disabled
        NO_COLOR: "1",
        COPILOT_ALLOW_ALL: "true",
      },
    });

    onProcess(proc);

    // Handle abort
    const abortHandler = () => {
      debug("[CopilotAdapter] Abort signal received");
      proc.kill("SIGTERM");
    };
    abortController.signal.addEventListener("abort", abortHandler);

    // Buffer for incomplete lines
    let buffer = "";

    // Process stdout
    proc.stdout?.setEncoding("utf-8");

    // Collect stderr for error reporting
    let stderrContent = "";
    proc.stderr?.setEncoding("utf-8");
    proc.stderr?.on("data", (chunk: string) => {
      stderrContent += chunk;
    });

    try {
      // Create a promise that resolves when process exits
      const exitPromise = new Promise<number | null>((resolve, reject) => {
        proc.on("close", resolve);
        proc.on("error", reject);
      });

      // Stream stdout data
      for await (const chunk of proc.stdout as AsyncIterable<string>) {
        if (abortController.signal.aborted) {
          break;
        }

        buffer += chunk;

        // Process complete lines
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.trim()) {
            // Each line is text output from the model
            yield {
              type: "text",
              content: line + "\n",
            };
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        yield {
          type: "text",
          content: buffer,
        };
      }

      // Wait for process to exit
      const exitCode = await exitPromise;
      debug(`[CopilotAdapter] Process exited with code: ${exitCode}`);

      // Check for errors
      if (exitCode !== 0 && stderrContent) {
        debug(`[CopilotAdapter] stderr: ${stderrContent}`);
        yield {
          type: "error",
          content: stderrContent || `Copilot CLI exited with code ${exitCode}`,
        };
      }

      // Signal completion
      yield { type: "complete" };
    } finally {
      abortController.signal.removeEventListener("abort", abortHandler);
    }
  }

  /**
   * Check if Copilot CLI is installed and authenticated.
   *
   * Checks:
   * 1. Is the 'copilot' CLI installed and accessible?
   * 2. Is the user authenticated with GitHub?
   */
  async isAvailable(): Promise<boolean> {
    try {
      const copilotPath = this.findCopilotCli();
      if (!copilotPath) {
        debug("[CopilotAdapter] isAvailable: false (CLI not found)");
        return false;
      }

      // Check version to verify CLI is functional
      execSync(`"${copilotPath}" --version`, { stdio: "pipe", timeout: 10000 });

      // Check if user is authenticated via gh CLI
      // The copilot CLI uses GitHub CLI credentials
      try {
        const authOutput = execSync("gh auth status", { stdio: "pipe", encoding: "utf-8", timeout: 10000 });
        const isAuthenticated = authOutput.toLowerCase().includes("logged in");
        debug(`[CopilotAdapter] isAvailable: CLI found, gh authenticated=${isAuthenticated}`);
        return isAuthenticated;
      } catch {
        // gh auth status failed - not authenticated
        debug("[CopilotAdapter] isAvailable: false (gh not authenticated)");
        return false;
      }
    } catch (error) {
      debug(`[CopilotAdapter] isAvailable: false (${error instanceof Error ? error.message : "unknown error"})`);
      return false;
    }
  }

  /**
   * Get list of models available through GitHub Copilot.
   *
   * Based on `copilot help config` output:
   * - claude-sonnet-4.5, claude-haiku-4.5, claude-opus-4.5
   * - gpt-5, gpt-5.2, gpt-5.1, gpt-4.1
   * - gemini-3-pro-preview
   */
  getAvailableModels(): string[] {
    return [
      // Claude models via Copilot
      "claude-opus-4.5",
      "claude-sonnet-4.5",
      "claude-haiku-4.5",
      // OpenAI models
      "gpt-5",
      "gpt-5.2",
      "gpt-5.1",
      "gpt-4.1",
      // Google models
      "gemini-3-pro-preview",
    ];
  }

  /**
   * Map Copilot stream event to AgentEvent.
   *
   * The Copilot CLI outputs plain text, so most events are text_delta.
   * Tool execution details are embedded in the text output.
   */
  mapEvent(event: unknown): AgentEvent | null {
    const copilotEvent = event as CopilotStreamEvent;

    switch (copilotEvent.type) {
      case "text":
        return {
          type: "text_delta",
          text: copilotEvent.content || "",
        };

      case "thinking":
        // Map thinking to text_delta (UI handles thinking display)
        return {
          type: "text_delta",
          text: copilotEvent.content || "",
        };

      case "tool_start":
        return {
          type: "tool_start",
          toolName: copilotEvent.toolName || "unknown",
          toolUseId: copilotEvent.toolUseId || `tool-${Date.now()}`,
          input: copilotEvent.input || {},
        };

      case "tool_result":
        return {
          type: "tool_result",
          toolUseId: copilotEvent.toolUseId || "",
          result: copilotEvent.result || "",
          isError: copilotEvent.isError ?? false,
        };

      case "error":
        return {
          type: "error",
          message: copilotEvent.content || "Unknown Copilot error",
        };

      case "complete":
        return {
          type: "complete",
        };

      default:
        debug(`[CopilotAdapter] Unknown event type: ${(copilotEvent as CopilotStreamEvent).type}`);
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
   * Convert MCP server config to Copilot's expected JSON format.
   */
  private convertMcpServers(servers: ProviderQueryConfig["mcpServers"]): Record<string, unknown> | null {
    if (!servers || Object.keys(servers).length === 0) {
      return null;
    }

    const mcpConfig: Record<string, unknown> = {};

    for (const [name, server] of Object.entries(servers)) {
      if (typeof server === "object" && "type" in server) {
        if (server.type === "http" || server.type === "sse") {
          mcpConfig[name] = {
            url: server.url,
            ...(server.headers ? { headers: server.headers } : {}),
          };
        } else if (server.type === "stdio") {
          mcpConfig[name] = {
            command: server.command,
            args: server.args || [],
            env: server.env || {},
          };
        }
      }
    }

    return Object.keys(mcpConfig).length > 0 ? mcpConfig : null;
  }

  /**
   * Write MCP config to a temporary file and return the path.
   */
  private writeTempMcpConfig(config: Record<string, unknown>): string {
    const tempDir = join(tmpdir(), "craft-agent-copilot");
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }

    const tempPath = join(tempDir, `mcp-config-${Date.now()}.json`);
    writeFileSync(tempPath, JSON.stringify(config, null, 2), "utf-8");
    debug(`[CopilotAdapter] Wrote MCP config to: ${tempPath}`);
    return tempPath;
  }
}
