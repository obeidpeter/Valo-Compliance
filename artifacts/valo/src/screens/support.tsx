import { Link } from "wouter";
import { PageHeader } from "@/components/states";
import { TicketForm } from "@/components/ticket-form";
import { Show } from "@clerk/react";
import { CustomerSupportCases } from "@/components/support-cases";
import { WorkspaceNav } from "@/components/workspace-nav";

export default function Support() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <PageHeader eyebrow="Help" title="Report a problem">
        Your report is saved for a member of staff, and you get a reference at once. We do not promise when
        you will hear back. Cannot sign in? See{" "}
        <Link href="/account-access" className="text-primary underline underline-offset-4">
          Trouble signing in
        </Link>
        .
      </PageHeader>
      <TicketForm defaultCategory="support" />
      <Show when="signed-in">
        <CustomerSupportCases />
      </Show>
    </div>
  );
}

/**
 * WRK-001: the workspace shows the customer's enquiries. The same list of their own support requests
 * that the help page shows them signed in, with the way to report something new.
 */
export function WorkspaceSupportPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-10 lg:px-8">
      <WorkspaceNav />
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow">Support requests</p>
        <h1 className="font-display mt-2 text-4xl">Your requests and our replies.</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Each request you have sent, with its reference, where it stands and any reply. To tell us about
          something new,{" "}
          <Link href="/support" className="text-primary underline underline-offset-4">
            report a problem
          </Link>
          .
        </p>
      </header>
      <div className="grid">
        <CustomerSupportCases />
      </div>
    </div>
  );
}
