import type { OpenClawConfig } from "openclaw/plugin-sdk/googlechat";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type { GoogleChatAudienceType } from "./auth.js";
import { getGoogleChatRuntime } from "./runtime.js";

export type GoogleChatRuntimeEnv = {
  log?: (message: string) => void;
  error?: (message: string) => void;
};

export type GoogleChatMonitorOptions = {
  account: ResolvedGoogleChatAccount;
  config: OpenClawConfig;
  runtime: GoogleChatRuntimeEnv;
  abortSignal: AbortSignal;
  webhookPath?: string;
  webhookUrl?: string;
  pubsubSubscription?: string;
  pubsubMaxMessages?: number;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
};

export type GoogleChatCoreRuntime = ReturnType<typeof getGoogleChatRuntime>;

/** Shared context for processing Google Chat events (transport-agnostic). */
export type GoogleChatEventContext = {
  account: ResolvedGoogleChatAccount;
  config: OpenClawConfig;
  runtime: GoogleChatRuntimeEnv;
  core: GoogleChatCoreRuntime;
  statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
  mediaMaxMb: number;
};

export type WebhookTarget = GoogleChatEventContext & {
  path: string;
  audienceType?: GoogleChatAudienceType;
  audience?: string;
};
