"use client";

import dynamic from "next/dynamic";
import * as React from "react";

function LoadingApp() {
  return (
    <div className="boot" aria-busy="true" aria-label="Loading Valo">
      <span className="boot-mark">V</span>
    </div>
  );
}

// App reads window.location at module scope. Keep that module browser-only.
const App = dynamic(() => import("./App"), {
  ssr: false,
  loading: LoadingApp,
});

export default function ClientApp({ nonce }: { nonce?: string }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Render identical HTML on the server and the first client pass, even if the
  // dynamic chunk is already cached. Mount the browser router after hydration.
  return mounted ? <App nonce={nonce} /> : <LoadingApp />;
}
