import type { Metadata } from "next";
import type { ReactNode } from "react";

// Global product CSS (Tailwind preflight, :root font/colour/focus) is imported
// by the demo page itself, not here, so /embed-themes renders like a customer
// host page with none of Analyticool's styles.

export const metadata: Metadata = {
  title: "Analyticool Studio — Metric to React",
  description:
    "Describe, clarify, review and embed a metric over synthetic fixtures. Local, unauthenticated approval; an open-source prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
