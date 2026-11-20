import { PageHeader } from "@/components/page-parts";
import { PublicLink } from "@/components/public-link";
import { AccessSupportIsland } from "@/islands/access-support";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/contact");

export default function Contact() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <div>
        <PageHeader eyebrow="Contact" title="Write to the people building Valo.">
          No account needed. Your message is saved for a staff member with a reference you can quote. It is
          not emailed anywhere, and we do not promise a response time.
        </PageHeader>
        <p className="text-sm text-muted-foreground">
          Locked out? Use{" "}
          <PublicLink href="/account-access" className="text-primary underline underline-offset-4">
            account access help
          </PublicLink>
          .
        </p>
      </div>
      <AccessSupportIsland defaultTopic="general" />
    </div>
  );
}
