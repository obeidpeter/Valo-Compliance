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
}

export function describeError(err: unknown): DescribedError {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return {
      kind: "offline",
      message: "You appear to be offline. Nothing was lost; reconnect and try again.",
    };
  }
  const e = (err ?? {}) as MaybeApiError;
  const status = typeof e.status === "number" ? e.status : undefined;
  const data = (e.data ?? null) as { error?: unknown; currentRevision?: unknown } | null;
  const serverText = data && typeof data.error === "string" ? data.error : undefined;
  const currentRevision = data && typeof data.currentRevision === "number" ? data.currentRevision : undefined;
  if (status === undefined) {
    return {
      kind: "offline",
      message: "The Valo service could not be reached. Check your connection and retry.",
    };
  }
  if (status === 401)
    return { kind: "unauthenticated", status, message: serverText ?? "Please sign in to continue." };
  if (status === 403) {
    return {
      kind: "forbidden",
      status,
      message:
        serverText ??
        "Your account cannot access this yet. It may need email verification, or it may be suspended.",
    };
  }
  if (status === 404)
    return {
      kind: "notFound",
      status,
      message: serverText ?? "We could not find that record in your workspace.",
    };
  if (status === 409)
    return {
      kind: "conflict",
      status,
      message: serverText ?? "This was changed elsewhere since you opened it.",
      currentRevision,
    };
  if (status === 400 || status === 422)
    return {
      kind: "validation",
      status,
      message: serverText ?? "Some details were not accepted. Please review and try again.",
    };
  return {
    kind: "server",
    status,
    message: serverText ?? "Something went wrong on our side. Your work in this tab is unchanged.",
  };
}
