/** What an API failure means to the person using the page, with no other dependency, so a page's
 * island can explain a failure without loading the rest of the app's helpers. */
type MaybeApiError = { status?: number; data?: unknown; message?: string };

export type ErrorKind =
  "offline" | "unauthenticated" | "forbidden" | "conflict" | "validation" | "notFound" | "server";

export interface DescribedError {
  kind: ErrorKind;
  status?: number;
  message: string;
  currentRevision?: number | undefined;
  /** The failed request's reference in Valo's own records, to quote when reporting the failure. */
  reference?: string | undefined;
}

/**
 * Says what went wrong and what to do next. The server's own sentence is used where it sent one.
 * Nothing here promises that the customer's work is safe: this function cannot know what the page
 * holds, so the page says that itself where it is true.
 */
export function describeError(err: unknown): DescribedError {
  // Only where the browser says so. Outside a browser there is a `navigator` with no such flag,
  // and a missing flag is not a report of being offline.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { kind: "offline", message: "You seem to be offline. Reconnect and try again." };
  }
  const e = (err ?? {}) as MaybeApiError;
  const status = typeof e.status === "number" ? e.status : undefined;
  const data = (e.data ?? null) as {
    error?: unknown;
    currentRevision?: unknown;
    requestId?: unknown;
  } | null;
  const serverText = data && typeof data.error === "string" ? data.error : undefined;
  const currentRevision = data && typeof data.currentRevision === "number" ? data.currentRevision : undefined;
  const reference =
    data && typeof data.requestId === "string" && /^[A-Za-z0-9-]{1,64}$/.test(data.requestId)
      ? data.requestId
      : undefined;
  if (status === undefined) {
    return {
      kind: "offline",
      message: "Valo could not be reached. Check your connection and try again.",
    };
  }
  if (status === 401)
    return {
      kind: "unauthenticated",
      status,
      message: serverText ?? "You are not signed in, or your session has ended.",
    };
  if (status === 403) {
    return {
      kind: "forbidden",
      status,
      message:
        serverText ??
        "Your account cannot open this. Your email address may still need to be verified, or the account may be suspended.",
    };
  }
  if (status === 404)
    return { kind: "notFound", status, message: serverText ?? "We could not find that in your workspace." };
  if (status === 409)
    return {
      kind: "conflict",
      status,
      message: serverText ?? "This was changed somewhere else after you opened it.",
      currentRevision,
    };
  if (status === 400 || status === 422)
    return {
      kind: "validation",
      status,
      message: serverText ?? "Some details were not accepted. Check them and try again.",
    };
  if (status === 429)
    return {
      kind: "server",
      status,
      message: serverText ?? "Too many requests in a short time. Wait a moment and try again.",
    };
  return {
    kind: "server",
    status,
    message: serverText ?? "Something went wrong at Valo. Try again in a moment.",
    reference,
  };
}
