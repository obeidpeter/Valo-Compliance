import { PageHeader, Notice } from '@/components/states';
import { CATEGORY_LABELS, TicketForm } from '@/components/ticket-form';
import type { TicketInputCategory } from '@workspace/api-client-react';
import {useSearch} from 'wouter';

const SERVICE_CATS: TicketInputCategory[] = ['registration', 'tax', 'accounting', 'employment', 'legal', 'privacy', 'sector_approval'];

export default function Services() {
  const requested=new URLSearchParams(useSearch()).get('category');
  const selected=SERVICE_CATS.find(c=>c===requested)??'registration';
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 lg:px-8">
      <PageHeader eyebrow="Services" title="Need a person, not a page?">
        Describe what you need. Your enquiry is saved for Valo staff. No professional providers are listed yet, so nothing is booked or forwarded.
      </PageHeader>
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <div>
          <p className="eyebrow mb-4">Categories</p>
          <ul className="grid gap-2">
            {SERVICE_CATS.map((c) => (
              <li key={c} className="flex items-center justify-between rounded-xl border border-border px-4 py-3.5">
                <span>{CATEGORY_LABELS[c]}</span><span className="text-xs text-muted-foreground">No provider yet</span>
              </li>
            ))}
          </ul>
          <Notice className="mt-6" tone="ink" title="No prices, no promises">We have not set fees or response times. You will hear from a person before anything is arranged.</Notice>
        </div>
        <TicketForm key={selected} defaultCategory={selected} categories={SERVICE_CATS} intro="Enquiries require a signed-in, verified account." />
      </div>
    </div>
  );
}
