import { Link } from "wouter";
import { PageHeader } from "@/components/states";
import { AccessSupportForm } from "@/components/access-support-form";

export function AccountAccess() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <div>
        <PageHeader eyebrow="Help" title="Trouble signing in">
          This form works whether you are signed out, your email is not yet verified, or your account is
          suspended.
        </PageHeader>
        <ol className="grid gap-4 text-sm">
          {[
            [
              "Forgot your password",
              <>
                Use{" "}
                <Link href="/sign-in" className="text-primary underline underline-offset-4">
                  Forgot password
                </Link>{" "}
                on the sign-in screen. Our sign-in provider handles the recovery; Valo never sees your
                password.
              </>,
            ],
            ["Email not verified", "Enter the code sent to your inbox, then sign in again."],
            [
              "Suspended or still stuck",
              "Write to us here with the email you signed up with. Do not send passwords or codes.",
            ],
          ].map(([t, b], i) => (
            <li key={i} className="flex gap-4 border-t border-border pt-4">
              <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
              <div>
                <p className="font-medium">{t}</p>
                <p className="mt-1 leading-relaxed text-muted-foreground">{b}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <AccessSupportForm defaultTopic="account_access" />
    </div>
  );
}
