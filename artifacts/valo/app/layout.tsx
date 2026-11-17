import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../src/fonts.css";
import "../src/index.css";

export const metadata: Metadata = {
  title: "Valo — Business documents and source-governed guidance",
  description:
    "A private workspace for Nigerian SME owners: your business drafts kept separate from source-governed compliance guidance. In development; not launched.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f4ee" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body>{children}</body>
    </html>
  );
}
