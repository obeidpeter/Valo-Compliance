/** Browser lifecycle only; never a credential or replacement for server auth. */
export type RequestScope = { isCurrent: () => boolean; signal: AbortSignal; onUnauthorized?: () => void };
let provider: (() => RequestScope) | null = null;
export function installRequestScopeProvider(next: () => RequestScope) {
  provider = next;
  return () => {
    if (provider === next) provider = null;
  };
}
export function expiredAccountRequest() {
  return new DOMException("The account changed; this operation was discarded.", "AbortError");
}
export function assertRequestScope(scope: RequestScope | undefined) {
  if (scope && (!scope.isCurrent() || scope.signal.aborted)) throw expiredAccountRequest();
}
export function captureRequestScope() {
  const scope = provider?.();
  assertRequestScope(scope);
  return scope;
}
export function combineRequestSignals(...signals: (AbortSignal | null | undefined)[]) {
  const controller = new AbortController(),
    present = signals.filter((s): s is AbortSignal => !!s);
  const abort = () => controller.abort();
  for (const signal of present) {
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of present) signal.removeEventListener("abort", abort);
    },
  };
}
