'use client';

import dynamic from 'next/dynamic';

// The Wouter + Clerk app reads window.location directly, so it mounts only after hydration.
const App = dynamic(() => import('./App'), {
  ssr: false,
  loading: () => (
    <div className="boot" aria-busy="true" aria-label="Loading Valo">
      <span className="boot-mark">V</span>
    </div>
  ),
});

export default function ClientApp() {
  return <App />;
}
