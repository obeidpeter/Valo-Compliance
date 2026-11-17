/** Stop awaiting slow preparation dependencies on disconnect. A late result is
 * discarded, never used to publish or release an artifact. */
export async function abortable<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return run();
  let stop!: () => void;
  const cancelled = new Promise<never>((_resolve, reject) => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- rejects with the signal's own reason, as fetch does
    stop = () => reject(signal.reason ?? new DOMException("Cancelled", "AbortError"));
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    return await Promise.race([run(), cancelled]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
