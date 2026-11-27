/** An origin read from configuration: http or https, with no credentials, path, query or fragment,
 * and https outside development. Anything else is refused (null), never repaired. Request Host or
 * Forwarded headers never reach this function: only configuration chooses an origin.
 *
 * `loopbackHttp` also accepts plain http to this machine's own loopback address outside development,
 * for a call from one server process to another on the same host, which never crosses a network. */
export function configuredOrigin(
  raw: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  { loopbackHttp = false }: { loopbackHttp?: boolean } = {},
) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (
      !["http:", "https:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.pathname !== "/" ||
      u.search ||
      u.hash ||
      (env.NODE_ENV !== "development" && u.protocol !== "https:" && !(loopbackHttp && isLoopback(u.hostname)))
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** localhost, 127.0.0.0/8 or ::1, as a URL's hostname spells them. */
export function isLoopback(hostname: string) {
  return hostname === "localhost" || hostname === "[::1]" || /^127(\.\d{1,3}){3}$/.test(hostname);
}
