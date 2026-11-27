import { formatDay } from "@/lib/format";

/**
 * EDP-008: a released template's detail page shows the date its sources were checked, when it is
 * next due for review, the AI-review disclosure, its scope and its material limitations, as the
 * release states them. The API's `reviewedAt` for a template is its release's source-check date.
 */
export function ReleaseNotices({
  reviewedAt,
  reviewBy,
  disclosure,
  scope,
  limitations,
}: {
  reviewedAt: string;
  reviewBy: string;
  disclosure: string;
  scope: string;
  limitations: string;
}) {
  return (
    <>
      <dl className="grid gap-4 border-y border-border py-5 text-sm sm:grid-cols-2">
        <div>
          <dt className="eyebrow">Sources checked</dt>
          <dd className="mt-1" data-testid="text-reviewed">
            {formatDay(reviewedAt)}
          </dd>
        </div>
        <div>
          <dt className="eyebrow">Next review due</dt>
          <dd className="mt-1" data-testid="text-review-by">
            {formatDay(reviewBy)}
          </dd>
        </div>
      </dl>

      <section className="mt-8 grid gap-6 text-sm leading-relaxed">
        <div>
          <h2 className="eyebrow">How it was written and checked</h2>
          <p className="mt-2 whitespace-pre-line" data-testid="text-disclosure">
            {disclosure}
          </p>
        </div>
        <div>
          <h2 className="eyebrow">What it covers</h2>
          <p className="mt-2 whitespace-pre-line" data-testid="text-scope">
            {scope}
          </p>
        </div>
        <div>
          <h2 className="eyebrow">Limits you should know</h2>
          <p className="mt-2 whitespace-pre-line" data-testid="text-limitations">
            {limitations}
          </p>
        </div>
      </section>
    </>
  );
}
