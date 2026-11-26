import type { ReactNode } from "react";
import { Notice, PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { formatDay } from "@/lib/format";
import { fixedPageMetadata } from "@/server/page-metadata";
import {
  privacyNotice,
  privacyNoticeApproval,
  privacyNoticeApproved,
  type PrivacyNoticeEntry,
} from "@workspace/valo-core/privacy-notice";

export const generateMetadata = () => fixedPageMetadata("/privacy");

/** One processing activity of the notice, as the processing inventory records it. */
function Entry({ entry }: { entry: PrivacyNoticeEntry }) {
  const rows: [term: string, detail: ReactNode][] = [
    [
      "What it holds",
      <ul key="data" className="list-disc space-y-1 pl-5">
        {entry.data.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>,
    ],
    ["About whom", entry.subjects],
    ["Proposed lawful basis", entry.basis],
    ["Who at Valo reads it", entry.staff],
    ["Outside services", entry.services.join(" ")],
    ["How long it is kept", entry.retention],
  ];
  if (entry.choice) rows.push(["How you choose", entry.choice]);
  return (
    <section
      aria-labelledby={`privacy-${entry.id}`}
      className="rounded-2xl border border-border bg-card px-5 py-5"
      data-testid={`privacy-entry-${entry.id}`}
    >
      <h3 id={`privacy-${entry.id}`} className="font-display text-xl">
        {entry.title}
      </h3>
      <p className="mt-2 leading-relaxed">{entry.purpose}</p>
      <dl className="mt-4 grid gap-3 text-sm">
        {rows.map(([term, detail]) => (
          <div key={term}>
            <dt className="font-semibold">{term}</dt>
            <dd className="mt-1 leading-relaxed text-muted-foreground">{detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The privacy notice, made from the processing inventory (docs/architecture/processing-inventory.md). */
export default function Privacy() {
  const notice = privacyNotice();
  const approval = privacyNoticeApproved(notice) ? privacyNoticeApproval : null;
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Privacy" title={notice.title} />
      {approval ? (
        <Notice tone="forest" title="Approved notice">
          Valo&apos;s privacy owner approved these words on {formatDay(approval.approvedOn)}.
        </Notice>
      ) : (
        <Notice title="Draft notice">{notice.draft}</Notice>
      )}
      <p className="mt-3 text-sm text-muted-foreground" data-testid="text-privacy-version">
        Version {notice.version.slice(0, 12)}
      </p>
      <Notice tone="ink" className="mt-6" title="Use made-up details only">
        {notice.testData}
      </Notice>

      <section aria-labelledby="privacy-needed" className="mt-12" data-testid="privacy-needed">
        <h2 id="privacy-needed" className="font-display text-2xl">
          {notice.needed.heading}
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{notice.needed.intro}</p>
        <div className="mt-6 grid gap-5">
          {notice.needed.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </div>
      </section>

      <section aria-labelledby="privacy-optional" className="mt-12" data-testid="privacy-optional">
        <h2 id="privacy-optional" className="font-display text-2xl">
          {notice.optional.heading}
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{notice.optional.intro}</p>
        <div className="mt-6 grid gap-5">
          {notice.optional.entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
          <section
            aria-labelledby="privacy-marketing"
            className="rounded-2xl border border-border bg-card px-5 py-5"
            data-testid="privacy-entry-marketing"
          >
            <h3 id="privacy-marketing" className="font-display text-xl">
              {notice.optional.marketing.title}
            </h3>
            <p className="mt-2 leading-relaxed">{notice.optional.marketing.text}</p>
          </section>
        </div>
      </section>

      <section aria-labelledby="privacy-services" className="mt-12" data-testid="privacy-services">
        <h2 id="privacy-services" className="font-display text-2xl">
          {notice.services.heading}
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{notice.services.intro}</p>
        <ul className="mt-3 list-disc space-y-1 pl-5 leading-relaxed">
          {notice.services.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 leading-relaxed text-muted-foreground">{notice.services.unverified}</p>
      </section>

      <section aria-labelledby="privacy-backups" className="mt-12">
        <h2 id="privacy-backups" className="font-display text-2xl">
          {notice.backups.heading}
        </h2>
        <p className="mt-2 leading-relaxed text-muted-foreground">{notice.backups.text}</p>
      </section>

      <section aria-labelledby="privacy-rights" className="mt-12" data-testid="privacy-rights">
        <h2 id="privacy-rights" className="font-display text-2xl">
          {notice.rights.heading}
        </h2>
        <ul className="mt-3 grid gap-3 leading-relaxed">
          {notice.rights.items.map((item) => (
            <li key={item.link.href}>
              {item.text}{" "}
              <PublicLink
                href={item.link.href}
                className="font-medium text-primary underline underline-offset-4"
              >
                {item.link.label}
              </PublicLink>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
