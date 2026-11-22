import { SiteLinkTo as Link } from "./site-link";
import type { ReleasedResource, ReleasedResourceKind } from "@workspace/api-client-react";
import { formatDay } from "@/lib/format";

export const KIND_LABEL: Record<ReleasedResourceKind, string> = {
  guidance: "Guidance",
  guide: "Practical guide",
  industry_introduction: "Industry introduction",
  industry_pack: "Industry pack",
  location_pack: "Location pack",
};

export const liveContent = { refetchInterval: 15000, refetchOnWindowFocus: true } as const;

function referenceLinks(text: string, urls: readonly string[]) {
  return text.split(/(\[[^\]\n]+\]\(https:\/\/[^\s)]+\))/g).map((part, index) => {
    const link = /^\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)$/.exec(part);
    if (!link) return part;
    return urls.includes(link[2]!) ? (
      <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer" className="underline">
        {link[1]}
      </a>
    ) : (
      part
    );
  });
}

/** Plaintext paragraphs with optional links to the exact verified sources. */
export function PlainText({
  text,
  className,
  sourceUrls,
}: {
  text: string;
  className?: string;
  sourceUrls?: readonly string[];
}) {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <div className={className}>
      {paras.map((p, i) => {
        const lines = p.split("\n");
        return lines.every((line) => line.startsWith("• ")) ? (
          <ul key={i} className="list-disc space-y-1 pl-5">
            {lines.map((line, j) => (
              <li key={j}>{line.slice(2)}</li>
            ))}
          </ul>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {sourceUrls ? referenceLinks(p, sourceUrls) : p}
          </p>
        );
      })}
    </div>
  );
}

export function resourceCheckLabel(r: ReleasedResource) {
  if (r.publicationMethod === "manual") return r.kind === "guidance" ? "Sources checked" : "Published";
  return r.kind === "guide" && r.sources.length === 0 ? "Draft and evidence checked" : "Sources checked";
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
        {r.sources.length > 0 && (
          <span className="pill pill-ink">
            {r.sources.length} source{r.sources.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <p className="font-display mt-3 text-xl">{r.title}</p>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{r.summary}</p>
      <p className="mt-3 text-xs text-muted-foreground">
        {resourceCheckLabel(r)} {formatDay(r.reviewedAt)}
      </p>
    </Link>
  );
}
