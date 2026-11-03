# Contributing

Analyticool is an early prototype. Small, focused contributions are welcome. Open an issue before starting a large feature to agree on the smallest useful change.

1. Fork and clone, use Node 24 and pnpm 10.34.9, then run `pnpm install`.
2. Create a branch and run `pnpm dev` to explore the synthetic demo.
3. Keep domain contracts/calculations in `packages/core`, presentation in `packages/react`, and fixture wiring in `apps/demo`. Pass dependencies explicitly.
4. Add meaningful tests for changes to contracts or calculations. Keep examples deterministic and synthetic.
5. Run `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Use `pnpm format` to apply formatting.
6. Submit a pull request explaining the problem, resulting behavior, and checks performed. Link an issue when applicable; screenshots help with visible changes.

Do not commit secrets, customer data, production connection strings, or unreleased design references. Do not add cloud services, arbitrary SQL execution, orchestration frameworks, or a generic connector system as incidental changes.

Treat contributors respectfully. Report security concerns privately using [SECURITY.md](SECURITY.md). Contributions intentionally submitted for inclusion are provided under the repository's Apache-2.0 license; see its contribution terms.
