import type { TicketInputCategory } from "@workspace/api-client-react";
import { Notice, PageHeader } from "@/components/page-parts";
import { SERVICE_CATEGORIES, ServiceCategories } from "@/components/service-categories";
import { ServiceEnquiry } from "@/public-screens/services";
import { fixedPageMetadata } from "@/server/page-metadata";

export const generateMetadata = () => fixedPageMetadata("/services");

const SERVICE_CATS: TicketInputCategory[] = [...SERVICE_CATEGORIES];

export default async function Services({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requested = (await searchParams).category;
  const selected = SERVICE_CATS.find((c) => c === requested) ?? "registration";
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Services" title="Ask about a service">
        Describe what you need. Your enquiry is saved for Valo staff. No professional providers are listed
        yet, so nothing is booked or forwarded.
      </PageHeader>
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="eyebrow mb-4">What you can ask about</p>
          <ServiceCategories />
          <Notice className="mt-6" tone="ink" title="No prices, no promises">
            We have not set fees or response times. You will hear from a person before anything is arranged.
          </Notice>
        </div>
        <ServiceEnquiry category={selected} categories={SERVICE_CATS} />
      </div>
    </div>
  );
}
