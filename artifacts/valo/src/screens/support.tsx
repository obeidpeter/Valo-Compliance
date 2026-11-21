import { Link } from "wouter";
import { PageHeader } from "@/components/states";
import { TicketForm } from "@/components/ticket-form";
import { Show } from "@clerk/react";
import { CustomerSupportCases } from "@/components/support-cases";

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
