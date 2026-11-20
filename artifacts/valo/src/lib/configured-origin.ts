/** An origin read from configuration: http or https, with no credentials, path, query or fragment,
 * and https outside development. Anything else is refused (null), never repaired. Request Host or
 * Forwarded headers never reach this function: only configuration chooses an origin. */
export function configuredOrigin(raw: string | undefined, env: NodeJS.ProcessEnv = process.env) {
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
      (env.NODE_ENV !== "development" && u.protocol !== "https:")
    )
      return null;
    return u.origin;
  } catch {
    return null;
  }
}
