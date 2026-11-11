import type { Metadata } from "next";
import type { ReactNode } from "react";

// Global product CSS (Tailwind preflight, :root font/colour/focus) is imported
// by the demo page itself, not here, so /embed-themes renders like a customer
// host page with none of Analyticool's styles.

export const metadata: Metadata = {
  title: "Analyticool — Metric to React",
  description:
    "Review a metric definition, verify synthetic revenue, and embed it in React. An open-source prototype.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
