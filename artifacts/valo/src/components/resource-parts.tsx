import { SiteLinkTo as Link } from "./site-link";
import type { ReleasedResource, ReleasedResourceKind } from "@workspace/api-client-react";

export const KIND_LABEL: Record<ReleasedResourceKind, string> = {
  guidance: "Guidance",
  guide: "Practical guide",
  industry_pack: "Industry pack",
  location_pack: "Location pack",
};

export const liveContent = { refetchInterval: 15000, refetchOnWindowFocus: true } as const;

export function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" });
}

/** Released text rendered as plaintext paragraphs. Never interpreted as HTML. */
export function PlainText({ text, className }: { text: string; className?: string }) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={className}>
      {paras.map((p, i) => (
        <p key={i} className="whitespace-pre-line">
          {p}
        </p>
      ))}
    </div>
  );
}

export function ResourceCard({ r }: { r: ReleasedResource }) {
  return (
    <Link
      href={"/resources/" + encodeURIComponent(r.slug)}
      className="surface group block p-5 transition-colors hover:bg-secondary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      data-testid={"link-resource-" + r.slug}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="pill pill-forest">{KIND_LABEL[r.kind] ?? r.kind}</span>
        <span className="pill pill-ink">
          {r.sources.length} source{r.sources.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="font-display mt-3 text-xl">{r.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.summary}</p>
      <p className="mt-3 text-xs text-muted-foreground">Reviewed {fmtDay(r.reviewedAt)}</p>
    </Link>
  );
}
