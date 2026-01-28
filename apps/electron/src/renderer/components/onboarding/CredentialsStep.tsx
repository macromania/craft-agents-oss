/**
 * CredentialsStep - Onboarding step wrapper for API key, OAuth, or Copilot CLI flow
 *
 * Thin wrapper that composes ApiKeyInput, OAuthConnect, or CopilotSetupStep controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { ExternalLink } from "lucide-react";
import type { ApiSetupMethod } from "./APISetupStep";
import { StepFormLayout, BackButton, ContinueButton } from "./primitives";
import { ApiKeyInput, type ApiKeyStatus, type ApiKeySubmitData, OAuthConnect, type OAuthStatus } from "../apisetup";
import { CopilotSetupStep, type CopilotStatus } from "@craft-agent/ui";

export type CredentialStatus = ApiKeyStatus | OAuthStatus | CopilotStatus;

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod;
  status: CredentialStatus;
  errorMessage?: string;
  onSubmit: (data: ApiKeySubmitData) => void;
  onStartOAuth?: () => void;
  onBack: () => void;
  // Two-step OAuth flow
  isWaitingForCode?: boolean;
  onSubmitAuthCode?: (code: string) => void;
  onCancelOAuth?: () => void;
  // Copilot CLI flow
  copilotStatus?: CopilotStatus;
  onCopilotInstallClick?: () => void;
  onCopilotAuthenticateClick?: () => void;
  onCopilotRefreshClick?: () => void;
  onCopilotContinue?: () => void;
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  isWaitingForCode,
  onSubmitAuthCode,
  onCancelOAuth,
  // Copilot CLI props
  copilotStatus,
  onCopilotInstallClick,
  onCopilotAuthenticateClick,
  onCopilotRefreshClick,
  onCopilotContinue,
}: CredentialsStepProps) {
  const isOAuth = apiSetupMethod === "claude_oauth";
  const isCopilot = apiSetupMethod === "copilot_cli";

  // --- Copilot CLI flow ---
  if (isCopilot) {
    const effectiveStatus = copilotStatus ?? "checking";
    const isReady = effectiveStatus === "ready";

    return (
      <StepFormLayout
        title="Connect GitHub Copilot"
        description="Use your existing GitHub Copilot subscription to power AI agents."
        actions={
          <>
            <BackButton onClick={onBack} />
            <ContinueButton onClick={onCopilotContinue} disabled={!isReady} />
          </>
        }
      >
        <CopilotSetupStep
          status={effectiveStatus}
          errorMessage={errorMessage}
          onInstallClick={onCopilotInstallClick ?? (() => {})}
          onAuthenticateClick={onCopilotAuthenticateClick ?? (() => {})}
          onRefreshClick={onCopilotRefreshClick ?? (() => {})}
        />
      </StepFormLayout>
    );
  }

  // --- OAuth flow ---
  if (isOAuth) {
    // Waiting for authorization code entry
    if (isWaitingForCode) {
      return (
        <StepFormLayout
          title="Enter Authorization Code"
          description="Copy the code from the browser page and paste it below."
          actions={
            <>
              <BackButton onClick={onCancelOAuth} disabled={status === "validating"}>
                Cancel
              </BackButton>
              <ContinueButton type="submit" form="auth-code-form" disabled={false} loading={status === "validating"} loadingText="Connecting..." />
            </>
          }
        >
          <OAuthConnect status={status as OAuthStatus} errorMessage={errorMessage} isWaitingForCode={true} onStartOAuth={onStartOAuth!} onSubmitAuthCode={onSubmitAuthCode} onCancelOAuth={onCancelOAuth} />
        </StepFormLayout>
      );
    }

    return (
      <StepFormLayout
        title="Connect Claude Account"
        description="Use your Claude subscription to power multi-agent workflows."
        actions={
          <>
            <BackButton onClick={onBack} disabled={status === "validating"} />
            <ContinueButton onClick={onStartOAuth} className="gap-2" loading={status === "validating"} loadingText="Connecting...">
              <ExternalLink className="size-4" />
              Sign in with Claude
            </ContinueButton>
          </>
        }
      >
        <OAuthConnect status={status as OAuthStatus} errorMessage={errorMessage} isWaitingForCode={false} onStartOAuth={onStartOAuth!} onSubmitAuthCode={onSubmitAuthCode} onCancelOAuth={onCancelOAuth} />
      </StepFormLayout>
    );
  }

  // --- API Key flow ---
  return (
    <StepFormLayout
      title="API Configuration"
      description="Enter your API key. Optionally configure a custom endpoint for OpenRouter, Ollama, or compatible APIs."
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === "validating"} />
          <ContinueButton type="submit" form="api-key-form" disabled={false} loading={status === "validating"} loadingText="Validating..." />
        </>
      }
    >
      <ApiKeyInput status={status as ApiKeyStatus} errorMessage={errorMessage} onSubmit={onSubmit} />
    </StepFormLayout>
  );
}
