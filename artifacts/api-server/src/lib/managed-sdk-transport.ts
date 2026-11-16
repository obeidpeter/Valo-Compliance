import type { CompletionTransport } from "./inference-batch-dispatch";
import type { ManagedRequest, ManagedCompletionResult } from "./managed-inference";
export type ManagedSDKClient = {
  chat: {
    completions: {
      create: (
        request: ManagedRequest,
        options: { timeout: number; maxRetries: 0 },
      ) => Promise<ManagedCompletionResult>;
    };
  };
};
/** The callback means dispatch was attempted, not accepted, charged or settled.
 * Lazy loading is before final admission and observation. An import failure or
 * newly imposed hold must never reach SDK create or claim an outbound attempt. */
export function createManagedSDKTransport(load: () => Promise<ManagedSDKClient>): CompletionTransport {
  return async (request, options) => {
    const client = await load();
    await options.beforeOutbound?.();
    options.onOutbound?.();
    return client.chat.completions.create(request, { timeout: options.timeout, maxRetries: 0 });
  };
}
