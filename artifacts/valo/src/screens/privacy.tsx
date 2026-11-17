import { Notice, PageHeader } from "@/components/states";

export default function Privacy() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Privacy" title="How this build handles data" />
      <Notice title="Development notice">
        These are working notes for a development build. They have not been approved by Valo's owners or legal
        advisers, and they are not final privacy terms.
      </Notice>
      <div className="mt-10 grid gap-8">
        {[
          [
            "Use test data only",
            "Please do not enter real customer details or confidential business information. This build is for development and testing.",
          ],
          [
            "What we store",
            "Your account (via our authentication provider), your business profile revisions, your document drafts and their revisions, and any support requests you save.",
          ],
          [
            "Optional AI and current limits",
            "Evidence uploads and live payments are disabled. If you explicitly choose AI drafting and give separate consent, only the selected inputs are sent server-side through the configured Replit-managed OpenAI integration. Ordinary manual edits are not sent to AI. Provider retention, geography and production processing approvals remain unverified; do not submit confidential real data.",
          ],
          [
            "Marketing",
            "Marketing messages are opt-in only, set in your business profile, and off by default.",
          ],
        ].map(([h, b]: string[]) => (
          <section key={h}>
            <h2 className="font-display text-2xl">{h}</h2>
            <p className="mt-2 leading-relaxed text-muted-foreground">{b}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
