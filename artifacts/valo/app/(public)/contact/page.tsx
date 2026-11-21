import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { AccessSupportIsland } from "@/islands/access-support";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/contact");

export default function Contact() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <div>
        <PageHeader eyebrow="Help" title="Contact us">
          You do not need an account. Your message is saved for a member of staff, and you get a reference you
          can quote. It is not emailed anywhere, and we do not promise when you will hear back.
        </PageHeader>
        <p className="text-sm text-muted-foreground">
          Cannot sign in? See{" "}
          <PublicLink href="/account-access" className="text-primary underline underline-offset-4">
            Trouble signing in
          </PublicLink>
          .
        </p>
      </div>
      <AccessSupportIsland defaultTopic="general" />
    </div>
  );
}
