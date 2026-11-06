import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, URL } from "node:url";
import { resolve } from "node:path";
import process from "node:process";
import { format } from "prettier";

// Use the existing Vitest TypeScript loader, without an HTTP listener or new dependency.
const requireVitest = createRequire(import.meta.resolve("vitest/package.json"));
const { createServer } = await import(requireVitest.resolve("vite"));
const root = fileURLToPath(new URL("../", import.meta.url));
const pinnedNode = readFileSync(resolve(root, ".nvmrc"), "utf8").trim();
if (process.versions.node !== pinnedNode)
  throw new Error(
    `Use Node ${pinnedNode} (nvm use) to reproduce the pinned evidence.`,
  );
if (process.argv.slice(2).some((a) => a !== "--write"))
  throw new Error("Usage: pnpm verify:net-receipts [--write]");
const loader = await createServer({
  root,
  server: { middlewareMode: true },
  appType: "custom",
  configFile: false,
});
try {
  const { buildEvidence, digestBytes } = await loader.ssrLoadModule(
    "/verification/net-receipts/evidence.ts",
  );
  const report = buildEvidence(root);
  const bytes = await format(JSON.stringify(report), { parser: "json" });
  const path = resolve(root, "verification/net-receipts/report.json");
  if (process.argv.includes("--write")) writeFileSync(path, bytes);
  else if (readFileSync(path, "utf8") !== bytes)
    throw new Error(
      "Evidence is stale or tampered: replay differs from report.json. Inspect changes, then explicitly regenerate with --write.",
    );
  process.stdout.write(
    `${report.statement}\n${report.cases.length} cases; ${report.mutations.filter((m) => m.detected).length}/${report.mutations.length} incorrect variants detected.\nReport ${digestBytes(bytes)}\n${path}\n`,
  );
  if (report.status !== "passed") process.exitCode = 1;
} finally {
  await loader.close();
}
