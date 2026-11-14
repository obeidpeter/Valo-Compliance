import { Link } from 'wouter';
import { PageHeader } from '@/components/states';
import { TicketForm } from '@/components/ticket-form';

export default function Support() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-14 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <PageHeader eyebrow="Support" title="Tell us what went wrong.">
        Requests are saved to our queue and wait for a staff member. You get a reference immediately; we do not promise a response time.{' '}Cannot sign in? Use <Link href="/account-access" className="text-primary underline underline-offset-4">account access help</Link>.
      </PageHeader>
      <TicketForm defaultCategory="support" />
    </div>
  );
}
