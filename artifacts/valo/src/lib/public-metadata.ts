import { configuredOrigin } from "./configured-origin";

/** Only configuration may choose an origin. Request Host/Forwarded headers and
 * route parameters never choose a metadata fetch destination. */
export function metadataOrigin(env: NodeJS.ProcessEnv = process.env) {
  return configuredOrigin(
    env.VALO_TRUSTED_ORIGIN ??
      (env.NODE_ENV === "development" && env.REPLIT_DEV_DOMAIN
        ? `https://${env.REPLIT_DEV_DOMAIN}`
        : undefined),
    env,
  );
}
export { publicPages } from "./public-pages";
export type PublicMetadataItem = {
  path: string;
  title: string;
  description: string;
  modifiedAt: string | null;
};
export function parsePublicMetadata(raw: unknown): PublicMetadataItem[] {
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { items?: unknown }).items)) return [];
  return (raw as { items: unknown[] }).items
    .flatMap((value) => {
      if (!value || typeof value !== "object") return [];
      const r = value as Record<string, unknown>;
      if (
        typeof r.path !== "string" ||
        !/^\/(library|resources|industries)\/[A-Za-z0-9_%~-]+$/.test(r.path) ||
        typeof r.title !== "string" ||
        !r.title.trim() ||
        r.title.length > 300 ||
        typeof r.description !== "string" ||
        r.description.length > 1000
      )
        return [];
      try {
        const segment = decodeURIComponent(r.path.split("/")[2]!);
        // oxlint-disable-next-line eslint/no-control-regex -- refuses control characters and spaces in a path segment
        if (segment === "." || segment === ".." || /[/?#\\\u0000-\u0020]/.test(segment)) return [];
      } catch {
        return [];
      }
      return [
        {
          path: r.path,
          title: r.title,
          description: r.description,
          modifiedAt:
            typeof r.modifiedAt === "string" && Number.isFinite(Date.parse(r.modifiedAt))
              ? r.modifiedAt
              : null,
        },
      ];
    })
    .slice(0, 5000);
}
