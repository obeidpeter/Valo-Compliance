import type { StaffPreparedCandidate } from "@workspace/api-client-react";
import { formatDay } from "@/lib/format";

const STATES: Record<Exclude<StaffPreparedCandidate["state"], "saved">, string> = {
  awaiting_reviews: "Awaiting its two reviews",
  expired: "Review date passed; prepare it again",
  version_taken: "Another candidate was saved under this version number; prepare it again",
};

/**
 * Templates prepared for their two AI reviews (decision 0014). Until the reviews are checked, a
 * candidate is a private file, not a content version, so it has no publication record to open or
 * version to hold. The reference is what an operator passes to the review planning command.
 */
export function PreparedCandidates({ candidates }: { candidates: StaffPreparedCandidate[] }) {
  return (
    <section className="mt-8" aria-labelledby="prepared-candidates-title" data-testid="prepared-candidates">
      <h2 id="prepared-candidates-title" className="font-display text-2xl">
        Templates awaiting their reviews
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        A prepared template stays a private file until its two AI reviews are checked, and becomes a content
        version only then. Most recent 100.
      </p>
      {candidates.length === 0 ? (
        <p className="mt-3 text-sm">No prepared templates.</p>
      ) : (
        <ul className="mt-3 divide-y">
          {candidates.map((c) => (
            <li key={c.artifactId} className="py-3">
              <p className="font-medium">
                {c.templateId} · version {c.version}
              </p>
              <p className="text-sm text-muted-foreground">
                {c.state === "saved" ? `Saved as a ${c.savedStatus ?? "content"} version` : STATES[c.state]}
                {` · Prepared ${formatDay(c.preparedAt)} · Review by ${formatDay(c.reviewBy)}`}
              </p>
              <p className="mt-1 font-mono text-xs break-all">
                --candidate={c.artifactId}:{c.artifactHash}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
