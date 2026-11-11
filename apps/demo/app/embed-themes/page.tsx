import type { Metadata } from "next";
import { MetricChart, MetricKpi } from "@analyticool/react";
import { getDemoMetric } from "../../lib/demo-metric";
// Page-scoped host CSS. The root layout loads no product CSS, so this page is
// what a customer's own app looks like: only its styles plus the embeds.
import "./themes.css";

export const metadata: Metadata = {
  title: "Embed theming example — Analyticool",
  description:
    "The same synthetic metric rendered with the Analyticool default appearance and a fictional customer theme.",
};

const themes = [
  {
    id: "analyticool",
    title: "Analyticool default (Darkroom B+)",
    lead: "Copyable --ac-* variables recreate the B+ Studio look. The package itself ships none of it.",
    action: "Open report",
  },
  {
    id: "customer",
    title: "Ledgerly (fictional customer)",
    lead: "A light SaaS host with its own serif font, borders, accent and series colour. The embeds inherit the font.",
    action: "Export CSV",
  },
] as const;

export default function EmbedThemesPage() {
  // Computed once on the server; both themes render the identical result.
  const result = getDemoMetric();
  return (
    <main className="embed-themes">
      <header className="embed-themes__intro">
        <h1>One metric, two host themes</h1>
        <p>
          Synthetic data. The same <code>MetricKpi</code> and{" "}
          <code>MetricChart</code> result, styled only by host CSS variables and
          class hooks.
        </p>
      </header>
      <div className="embed-themes__grid">
        {themes.map((theme) => (
          <section
            key={theme.id}
            className={`theme-${theme.id}`}
            data-theme={theme.id}
            aria-labelledby={`${theme.id}-heading`}
          >
            <div className="host-bar">
              <div>
                <h2 id={`${theme.id}-heading`}>{theme.title}</h2>
                <p>{theme.lead}</p>
              </div>
              <button type="button">{theme.action}</button>
            </div>
            <MetricKpi result={result} className="host-card" />
            <MetricChart result={result} className="host-card" />
          </section>
        ))}
      </div>
    </main>
  );
}
