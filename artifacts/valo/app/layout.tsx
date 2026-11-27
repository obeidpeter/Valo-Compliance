import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "../src/fonts.css";
import "../src/index.css";

export const metadata: Metadata = {
  title: "Valo — Documents and business requirements",
  description:
    "Business documents and source-backed guidance for Nigerian small businesses. In development; not launched.",
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
