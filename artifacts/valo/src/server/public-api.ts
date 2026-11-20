import { configuredOrigin } from "@/lib/configured-origin";
import { metadataOrigin } from "@/lib/public-metadata";

/**
 * The web server's only way to read the API (decision 0011): the public endpoints, as an anonymous
 * visitor.
 *
 * - It sends no cookie and no Authorization header, so what a server-rendered page holds is what any
 *   anonymous visitor may see, and the same for every visitor. Only the editorial gates in the API
 *   decide what that is.
 * - It never uses the browser client's module-level settings (`setBaseUrl`, `setAuthTokenGetter`),
 *   which every request on a server would share.
 * - Only configuration chooses the API's address, never a request's Host or Forwarded headers.
 * - It checks every answer with the contract's schema, refuses redirects, caps the answer's size and
 *   gives up after READ_TIMEOUT_MS. A failure is returned, not thrown, so the page renders its
 *   unavailable or error state and the browser can try again.
 *
 * The repository rule `public-server` keeps the identity SDK and the browser client out of this
 * folder and the public routes' server code.
 */
export const READ_TIMEOUT_MS = 1500;
/** Larger than any public answer the contract allows: the catalogue's page is 20 rows, discovery at
 * most 5,000 entries of bounded length. */
export const MAX_ANSWER_BYTES = 4 * 1024 * 1024;

export type PublicRead<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** unconfigured: no usable API address. not-found: the API has no such public item, which is
       * also how its production gate answers. refused: the API refused the read, such as its rate
       * limit. failed: no usable answer in time: a network error, a redirect, a server error, an
       * answer too large or one the contract's schema rejects. */
      reason: "unconfigured" | "not-found" | "refused" | "failed";
    };

/** The API's address: `VALO_API_INTERNAL_ORIGIN` when it is set, and otherwise the configured public
 * origin, which serves the API under /api as well. A set but unusable value is refused rather than
 * replaced. Outside development it must be https, or plain http to this machine's loopback address. */
export function apiOrigin(env: NodeJS.ProcessEnv = process.env) {
  const internal = env.VALO_API_INTERNAL_ORIGIN;
  if (internal !== undefined && internal !== "")
    return configuredOrigin(internal, env, { loopbackHttp: true });
  return metadataOrigin(env);
}

/** A public endpoint path with an optional query, as callers build it with `segment` and
 * URLSearchParams. No dot segments, empty segments or other characters. */
export function isPublicPath(path: string) {
  const [pathname = "", ...rest] = path.split("?");
  return (
    rest.length <= 1 &&
    /^\/public(\/[A-Za-z0-9_~%-]+(\.[A-Za-z0-9_~%-]+)*)+$/.test(pathname) &&
    /^[A-Za-z0-9_~%.=&+*-]*$/.test(rest[0] ?? "")
  );
}

/** One path segment from any text, such as a slug from the visitor's address, encoded so the path it
 * goes into always passes isPublicPath: encodeURIComponent, and also the characters it leaves as
 * they are. A slug that cannot name a public item then reads as not found. */
export function segment(value: string) {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*.]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return encoded || "%20";
}

/** An X-Forwarded-For value as proxies write it: addresses, commas and spaces. Anything else is not
 * passed on. */
const FORWARDED_FOR = /^[0-9A-Fa-f.:[\], ]{1,512}$/;

type Schema<T> = { parse: (value: unknown) => T };

export async function readPublic<T>(
  path: string,
  schema: Schema<T>,
  options: {
    /** The X-Forwarded-For header the web server received, passed on unchanged. */
    forwardedFor?: string | null | undefined;
    env?: NodeJS.ProcessEnv;
    timeoutMs?: number;
  } = {},
): Promise<PublicRead<T>> {
  if (!isPublicPath(path)) throw new Error("PUBLIC_API_PATH_INVALID");
  const origin = apiOrigin(options.env);
  if (!origin) return { ok: false, reason: "unconfigured" };
  const headers = new Headers({ accept: "application/json" });
  if (options.forwardedFor && FORWARDED_FOR.test(options.forwardedFor))
    headers.set("x-forwarded-for", options.forwardedFor);
  try {
    const response = await fetch(`${origin}/api${path}`, {
      headers,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? READ_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ok: false,
        reason: response.status === 404 ? "not-found" : response.status === 429 ? "refused" : "failed",
      };
    }
    const text = await boundedText(response, MAX_ANSWER_BYTES);
    if (text === null) return { ok: false, reason: "failed" };
    return { ok: true, data: schema.parse(JSON.parse(text)) };
  } catch {
    // A network error, timeout, refused redirect, malformed JSON or an answer the schema rejects:
    // the page shows its error state, and nothing about the visitor is in the error to log.
    return { ok: false, reason: "failed" };
  }
}

/** The body as UTF-8 text, or null once it is longer than `limit` bytes. */
async function boundedText(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    return null;
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
