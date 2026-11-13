import { Link } from 'wouter';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-28 text-center">
      <p className="eyebrow">404</p>
      <h1 className="font-display mt-4 text-5xl">This page is not on either shelf.</h1>
      <p className="mt-4 text-muted-foreground">The address may be mistyped, or the page has not been built.</p>
      <div className="mt-8 flex justify-center gap-2"><Link href="/" className="btn btn-primary">Go home</Link><Link href="/help" className="btn btn-ghost">Help</Link></div>
    </div>
  );
}
