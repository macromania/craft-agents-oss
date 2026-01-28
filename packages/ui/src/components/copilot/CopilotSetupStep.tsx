/**
 * CopilotSetupStep - Reusable component for GitHub Copilot CLI authentication status
 *
 * Used in the onboarding wizard to guide users through setting up GitHub Copilot
 * as their AI provider. Handles three states:
 * - not_installed: Copilot CLI needs to be installed
 * - not_authenticated: CLI is installed but user needs to authenticate
 * - ready: CLI is installed and authenticated, ready to use
 */

import * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../ui/LoadingIndicator";

export type CopilotStatus = "checking" | "not_installed" | "not_authenticated" | "ready";

export interface CopilotSetupStepProps {
  /** Current status of the Copilot CLI */
  status: CopilotStatus;
  /** Error message to display, if any */
  errorMessage?: string;
  /** Called when user clicks "Install Copilot CLI" */
  onInstallClick: () => void;
  /** Called when user clicks "Authenticate" */
  onAuthenticateClick: () => void;
  /** Called when user clicks "Refresh Status" to recheck CLI status */
  onRefreshClick: () => void;
  /** Additional className for the container */
  className?: string;
}

/**
 * CopilotSetupStep - GitHub Copilot CLI authentication status display
 *
 * This is a presentational component that shows the current status of the
 * GitHub Copilot CLI and provides appropriate actions for each state.
 *
 * Usage in onboarding:
 * ```tsx
 * <CopilotSetupStep
 *   status={copilotStatus}
 *   errorMessage={errorMessage}
 *   onInstallClick={() => openExternal('https://...')}
 *   onAuthenticateClick={() => runCopilotAuth()}
 *   onRefreshClick={() => recheckCopilotStatus()}
 * />
 * ```
 */
export function CopilotSetupStep({ status, errorMessage, onInstallClick, onAuthenticateClick, onRefreshClick, className }: CopilotSetupStepProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Status Display */}
      <div className="space-y-3">
        {status === "checking" && (
          <StatusCard variant="neutral">
            <div className="flex items-center gap-3">
              <Spinner className="text-muted-foreground" />
              <span className="text-muted-foreground">Checking GitHub Copilot CLI status...</span>
            </div>
          </StatusCard>
        )}

        {status === "not_installed" && (
          <StatusCard variant="warning">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <StatusIcon variant="warning" />
                <div className="space-y-1">
                  <p className="font-medium">GitHub Copilot CLI not found</p>
                  <p className="text-sm text-muted-foreground">Install the GitHub Copilot CLI to continue. This requires Node.js 18+ to be installed.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onInstallClick}
                  className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  View Installation Guide
                </button>
                <button
                  onClick={onRefreshClick}
                  className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </StatusCard>
        )}

        {status === "not_authenticated" && (
          <StatusCard variant="info">
            <div className="space-y-3">
              <div className="flex items-start gap-3">
                <StatusIcon variant="info" />
                <div className="space-y-1">
                  <p className="font-medium">Authentication required</p>
                  <p className="text-sm text-muted-foreground">GitHub Copilot CLI is installed but not authenticated. Run the authentication command to connect your GitHub account.</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onAuthenticateClick}
                  className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Authenticate with GitHub
                </button>
                <button
                  onClick={onRefreshClick}
                  className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Refresh Status
                </button>
              </div>
            </div>
          </StatusCard>
        )}

        {status === "ready" && (
          <StatusCard variant="success">
            <div className="flex items-start gap-3">
              <StatusIcon variant="success" />
              <div className="space-y-1">
                <p className="font-medium">GitHub Copilot is ready</p>
                <p className="text-sm text-muted-foreground">You&apos;re all set! Your GitHub Copilot subscription will power your AI agents.</p>
              </div>
            </div>
          </StatusCard>
        )}

        {/* Error Message */}
        {errorMessage && (
          <StatusCard variant="error">
            <div className="flex items-start gap-3">
              <StatusIcon variant="error" />
              <div className="space-y-1">
                <p className="font-medium">Error</p>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>
          </StatusCard>
        )}
      </div>
    </div>
  );
}

// ============================================
// Helper Components
// ============================================

type StatusVariant = "neutral" | "warning" | "info" | "success" | "error";

interface StatusCardProps {
  variant: StatusVariant;
  children: React.ReactNode;
}

function StatusCard({ variant, children }: StatusCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl p-4 shadow-minimal",
        variant === "neutral" && "bg-foreground-2",
        variant === "warning" && "bg-amber-500/5 border border-amber-500/20",
        variant === "info" && "bg-blue-500/5 border border-blue-500/20",
        variant === "success" && "bg-emerald-500/5 border border-emerald-500/20",
        variant === "error" && "bg-red-500/5 border border-red-500/20"
      )}
    >
      {children}
    </div>
  );
}

interface StatusIconProps {
  variant: StatusVariant;
}

function StatusIcon({ variant }: StatusIconProps) {
  const iconClass = cn("size-5 shrink-0 mt-0.5", variant === "warning" && "text-amber-500", variant === "info" && "text-blue-500", variant === "success" && "text-emerald-500", variant === "error" && "text-red-500");

  switch (variant) {
    case "warning":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      );
    case "info":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "success":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "error":
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    default:
      return null;
  }
}
