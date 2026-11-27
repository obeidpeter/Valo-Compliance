import { useState } from "react";
import { Link, useSearch } from "wouter";
import { CheckCircle2, Loader2 } from "lucide-react";
import { useUnsubscribe } from "@workspace/api-client-react";
import { PageHeader } from "@/components/states";
import { describeError } from "@/lib/describe-error";
import { useDocumentTitle } from "@/lib/document-title";

/**
 * Where the unsubscribe link in a reminder email leads (docs/architecture/messages.md, part 4). Nobody
 * needs to sign in. Opening the page changes nothing: a mail program or a scanner that follows the link
 * stops no one's reminders. Reminders stop when the button is pressed.
 */
export default function Unsubscribe() {
  useDocumentTitle("Stop reminder emails — Valo");
  // Read once: the link's token is the page's whole input, and it is sent nowhere until the button is pressed.
  const [token] = useState(new URLSearchParams(useSearch()).get("t") ?? "");
  const mutation = useUnsubscribe();
  const inValo = (
    <>
      You can turn reminder emails off or on in Valo: sign in and open{" "}
      <Link
        href="/workspace/reminders"
        className="text-primary underline underline-offset-4"
        data-testid="link-unsubscribe-reminders"
      >
        Reminders
      </Link>
      .
    </>
  );

  if (mutation.isSuccess)
    return (
      <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
        <div className="surface reveal p-6 sm:p-8" role="status" data-testid="unsubscribe-done">
          <CheckCircle2 className="h-7 w-7 text-primary" aria-hidden />
          <h1 className="font-display mt-4 text-2xl">Reminder emails are off</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Valo will send no more reminder emails for the workspace this link came from. Any reminder that
            was waiting has been cancelled. Your tasks and their due dates are as they were.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{inValo}</p>
        </div>
      </div>
    );

  const err = mutation.error ? describeError(mutation.error) : null;
  return (
    <div className="mx-auto max-w-3xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Reminders" title="Stop reminder emails">
        {token
          ? "Press the button to stop Valo's reminder emails for the workspace this link came from. Nothing changes until you do."
          : "This link is incomplete, so there is nothing here to stop."}
      </PageHeader>
      {token ? (
        <div className="surface grid gap-5 p-6 sm:p-8">
          <p className="text-sm leading-relaxed text-muted-foreground" data-testid="text-unsubscribe-effect">
            Reminders that are waiting will be cancelled. Your tasks and their due dates stay as they are, and
            you do not need to sign in.
          </p>
          {err && (
            <p
              role="alert"
              className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
              data-testid="text-unsubscribe-error"
            >
              {err.message}
            </p>
          )}
          <div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ data: { token } })}
              data-testid="button-unsubscribe"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />} Stop reminder
              emails
            </button>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{inValo}</p>
        </div>
      ) : (
        <p
          className="text-sm leading-relaxed text-muted-foreground"
          data-testid="text-unsubscribe-incomplete"
        >
          Open the link from the reminder email again, in full. {inValo}
        </p>
      )}
    </div>
  );
}
