/** Only configuration may choose an origin. Request Host/Forwarded headers and
 * route parameters never choose a metadata fetch destination. */
export function metadataOrigin(env: NodeJS.ProcessEnv = process.env) {
  const raw =
    env.VALO_TRUSTED_ORIGIN ??
    (env.NODE_ENV === "development" && env.REPLIT_DEV_DOMAIN
      ? `https://${env.REPLIT_DEV_DOMAIN}`
      : undefined);
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
export const publicPages: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Valo — Documents and business requirements",
    description:
      "Prepare business documents and explore source-backed guidance for Nigerian SMEs. Check the stated scope and availability of every item.",
  },
  "/library": {
    title: "Document library — Valo",
    description:
      "Search released business templates and guidance by keyword, category, industry and access level.",
  },
  "/resources": {
    title: "Business resources — Valo",
    description: "Browse currently released business guidance, with source details and review dates.",
  },
  "/industries": {
    title: "Industry coverage — Valo",
    description: "Explore available guidance by business activity. A coverage gap is not an exemption.",
  },
  "/services": {
    title: "Service enquiries — Valo",
    description:
      "Save a request for staff review. An enquiry does not confirm a professional provider, appointment or referral.",
  },
  "/about": {
    title: "About Valo",
    description: "Learn about Valo’s business document and guidance platform for Nigerian SMEs.",
  },
  "/contact": { title: "Contact Valo", description: "Contact Valo about the platform or access support." },
  "/help": { title: "Help — Valo", description: "Help using Valo’s workspace, documents and guidance." },
  "/compliance": {
    title: "Business requirements — Valo",
    description:
      "Explore source-backed requirements and understand the limits of currently available guidance.",
  },
  "/checker": {
    title: "Business requirements checker — Valo",
    description:
      "Explore possible business requirements using your supplied facts and currently available source evidence.",
  },
  "/pricing": {
    title: "Pricing — Valo",
    description: "See available access options and the current status of paid features.",
  },
  "/privacy": {
    title: "Privacy — Valo",
    description: "Read Valo’s privacy information and available account request routes.",
  },
  "/terms": { title: "Terms — Valo", description: "Read the current terms and limits for using Valo." },
};
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
export async function fetchPublicMetadata(origin: string) {
  try {
    const r = await fetch(origin + "/api/public/discovery", {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    });
    return r.ok ? parsePublicMetadata(await r.json()) : [];
  } catch {
    return [];
  }
}
