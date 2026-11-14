import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import * as react from "@analyticool/react";
import { EMBED_SNIPPET } from "./embed-snippet";

const exampleSource = readFileSync(
  new URL("./embed-example.tsx", import.meta.url),
  "utf8",
);

it("is exactly the typechecked embed-example.tsx source", () => {
  expect(EMBED_SNIPPET).toBe(exampleSource);
});

it("uses the current result-prop API and no hosted component or token", () => {
  expect(EMBED_SNIPPET).toContain("<MetricChart result={result} />");
  expect(EMBED_SNIPPET).toContain("<MetricKpi result={result} />");
  expect(EMBED_SNIPPET).not.toMatch(/<Metric[\s/>]/);
  expect(EMBED_SNIPPET).not.toMatch(/token|apiKey|\bid=/i);
  const imported = /import \{ ([^}]+) \} from "@analyticool\/react"/
    .exec(EMBED_SNIPPET)?.[1]
    ?.split(",")
    .map((name) => name.trim());
  expect(imported).toEqual(["MetricChart", "MetricKpi"]);
  for (const name of imported ?? [])
    expect(typeof (react as Record<string, unknown>)[name]).toBe("function");
});
