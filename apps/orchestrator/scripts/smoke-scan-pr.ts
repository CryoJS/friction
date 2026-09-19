/**
 * smoke-scan.ts with pull requests: a mock scan started with a repository,
 * ending in one preview and nine covered tasks. Pushes nothing.
 *
 *   pnpm dev:worker
 *   FRICTION_MOCK=1 pnpm dev:orchestrator
 *   pnpm --filter @friction/orchestrator smoke:scan-pr [url]
 */
process.env.SMOKE_PR = "1";
await import("./smoke-scan");

export {};
