import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { useListOperationalRecommendations } from "@workspace/api-client-react";

/**
 * Business documents offered under a result: the same list for everyone. They are not legal
 * recommendations, and are not worked out from the result above them.
 */
export function OperationalAids() {
  const recs = useListOperationalRecommendations({
    query: { refetchInterval: 15000, refetchOnWindowFocus: true, retry: false },
  });
  const items = recs.data?.items ?? [];
  if (recs.isError) {
    return (
      <div
        role="status"
        className="surface flex flex-wrap items-center justify-between gap-3 p-4 text-sm"
        data-testid="status-operational-aids-error"
      >
        <p className="min-w-0 text-muted-foreground">
          A list of optional business documents could not be loaded. Your results above are not affected.
        </p>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={recs.isFetching}
          onClick={() => recs.refetch()}
          data-testid="button-retry-operational-aids"
        >
          {recs.isFetching ? "Trying again…" : "Try again"}
        </button>
      </div>
    );
  }
  if (recs.isLoading || items.length === 0) return null;
  return (
    <section
      className="surface p-5"
      aria-labelledby="ops-aids-heading"
      data-testid="section-operational-aids"
    >
      <p className="eyebrow">Optional</p>
      <h3 id="ops-aids-heading" className="font-display mt-1 text-lg">
        Business documents you may find useful
      </h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        These are general business templates, shown the same way to everyone. They are not legal advice, are
        not chosen from your answers, and do not mean any duty applies to you.
      </p>
      <ul className="mt-4 grid gap-2">
        {items.map((it) => (
          <li key={it.id} className="min-w-0">
            <Link
              href={"/library/" + encodeURIComponent(it.slug)}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-secondary"
              data-testid={"link-aid-" + it.slug}
            >
              <span className="min-w-0">
                <span className="block font-medium">{it.title}</span>
                <span className="block truncate text-muted-foreground">{it.summary}</span>
              </span>
              <ArrowRight
                className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5"
                aria-hidden
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
