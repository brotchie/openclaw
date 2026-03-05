import { PubSub } from "@google-cloud/pubsub";
import type { Message } from "@google-cloud/pubsub";
import type { ResolvedGoogleChatAccount } from "./accounts.js";
import type {
  GoogleChatCoreRuntime,
  GoogleChatEventContext,
  GoogleChatRuntimeEnv,
} from "./monitor-types.js";
import type { GoogleChatEvent } from "./types.js";

export type PubSubMonitorParams = {
  subscriptionName: string;
  maxMessages?: number;
  context: GoogleChatEventContext;
  runtime: GoogleChatRuntimeEnv;
  abortSignal: AbortSignal;
  processEvent: (event: GoogleChatEvent, context: GoogleChatEventContext) => Promise<void>;
};

function createPubSubClient(account: ResolvedGoogleChatAccount): PubSub {
  if (account.credentials) {
    return new PubSub({
      credentials: account.credentials as { client_email: string; private_key: string },
    });
  }
  if (account.credentialsFile) {
    return new PubSub({ keyFilename: account.credentialsFile });
  }
  // Fall back to Application Default Credentials.
  return new PubSub();
}

function isValidChatEvent(raw: unknown): raw is GoogleChatEvent {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return false;
  }
  const obj = raw as Record<string, unknown>;
  const eventType = obj.type ?? obj.eventType;
  if (typeof eventType !== "string") {
    return false;
  }
  if (!obj.space || typeof obj.space !== "object") {
    return false;
  }
  return true;
}

function logVerbose(core: GoogleChatCoreRuntime, runtime: GoogleChatRuntimeEnv, message: string) {
  if (core.logging.shouldLogVerbose()) {
    runtime.log?.(`[googlechat] ${message}`);
  }
}

export function startPubSubMonitor(params: PubSubMonitorParams): () => void {
  const { subscriptionName, context, runtime, abortSignal, processEvent } = params;
  const { core } = context;
  const accountId = context.account.accountId;

  if (abortSignal.aborted) {
    return () => {};
  }

  const credSource = context.account.credentialSource;
  runtime.log?.(
    `[${accountId}] pubsub: connecting to ${subscriptionName} (credentials: ${credSource})`,
  );

  const client = createPubSubClient(context.account);
  const maxMessages = params.maxMessages ?? 10;
  const subscription = client.subscription(subscriptionName, {
    flowControl: { maxMessages },
  });

  const messageHandler = (message: Message) => {
    try {
      const raw = JSON.parse(Buffer.from(message.data).toString("utf-8"));
      if (!isValidChatEvent(raw)) {
        runtime.error?.(
          `[${accountId}] pubsub: invalid event payload (id=${message.id}), skipping`,
        );
        message.ack();
        return;
      }
      const eventType = (raw as Record<string, unknown>).type ?? "unknown";
      const spaceName =
        ((raw as Record<string, unknown>).space as Record<string, unknown> | undefined)?.name ??
        "unknown";
      logVerbose(
        core,
        runtime,
        `pubsub: received ${eventType} event from ${spaceName} (msgId=${message.id})`,
      );

      context.statusSink?.({ lastInboundAt: Date.now() });
      // Ack immediately (fire-and-forget), matching the webhook pattern.
      message.ack();
      processEvent(raw, context).catch((err) => {
        runtime.error?.(
          `[${accountId}] pubsub: event processing failed (msgId=${message.id}): ${String(err)}`,
        );
      });
    } catch (err) {
      runtime.error?.(
        `[${accountId}] pubsub: failed to parse message (id=${message.id}): ${String(err)}`,
      );
      message.ack();
    }
  };

  const errorHandler = (err: Error) => {
    runtime.error?.(`[${accountId}] pubsub: subscription error: ${String(err)}`);
  };

  subscription.on("message", messageHandler);
  subscription.on("error", errorHandler);

  runtime.log?.(
    `[${accountId}] pubsub: listening on ${subscriptionName} (maxMessages=${maxMessages})`,
  );

  const cleanup = () => {
    runtime.log?.(`[${accountId}] pubsub: closing subscription`);
    subscription.removeListener("message", messageHandler);
    subscription.removeListener("error", errorHandler);
    void subscription.close().catch((err) => {
      runtime.error?.(`[${accountId}] pubsub: cleanup error: ${String(err)}`);
    });
  };

  abortSignal.addEventListener("abort", cleanup, { once: true });

  return cleanup;
}
