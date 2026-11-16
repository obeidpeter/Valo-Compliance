/** Trust deployment configuration, never request Host/Forwarded headers. */
export function trustedSiteOrigin(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw =
    env.VALO_TRUSTED_ORIGIN ??
    (env.NODE_ENV === "development" &&
    !Object.keys(env).some(
      (k) => (k === "REPLIT_DEPLOYMENT" || k.startsWith("REPLIT_DEPLOYMENT_")) && Boolean(env[k]?.length),
    ) &&
    env.REPLIT_DEV_DOMAIN
      ? `https://${env.REPLIT_DEV_DOMAIN}`
      : undefined);
  if (!raw) return undefined;
  try {
    const parsed = new URL(raw);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      return undefined;
    if (env.NODE_ENV !== "development" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
export function permittedMutationOrigin(origin: string | undefined, trusted: string | undefined): boolean {
  if (!origin || !trusted) return false;
  try {
    const parsed = new URL(origin);
    return origin === parsed.origin && parsed.origin === trusted;
  } catch {
    return false;
  }
}
