# Friction

### Autonomous QA that finds the flaw, proves the fix, and opens the PR.

Programmers have automated product development, so what's next?
Product testing.

Friction gives an AI agent a website and asks it to complete the tasks that matter most to a first time visitor. The agent uses a real browser, records what happened, and turns the evidence into a severity ranked report. Then, Friction proposes a small fix, installs it in a fresh browser session, and reruns the exact same task to verify whether the experience actually improved.

If the fix is verified and can be mapped back to the source, Friction can open a draft GitHub pull request with a regression test.

Built for [Hack the North 2026](https://devpost.com/software/friction-z0xgf6).

## Watch the demo

[![Watch Friction on YouTube](https://img.youtube.com/vi/8UGiKTf0RAI/maxresdefault.jpg)](https://www.youtube.com/watch?v=8UGiKTf0RAI)


## Why it stands out

- **Tests like a visitor.** One agent navigates a live site and attempts realistic, high value tasks instead of checking isolated selectors.
- **Findings come with evidence.** Each issue includes the observed interaction, screenshot evidence, severity, confidence, and how many tasks encountered it.
- **Fixes are experimentally verified.** A proposed patch is installed before first paint in a brand new browser context, then the same task is replayed.
- **The report is site wide.** Findings from multiple tasks are deduplicated and ranked so repeated friction rises to the top.
- **The loop can reach the codebase.** Verified fixes can be mapped to source, covered by a generated Playwright regression test, and opened as draft PRs.
- **The demo works without credentials.** Mock mode replays a deterministic golden run through the real pipeline, including fix verification.

## How it works

![friction-howitworks.png](public/readme/friction-howitworks.png)

The control room shows the scan as a live task tree and streams run events as they happen. The report brings each fix together with a **Before / After** comparison and the evidence behind the verdict.

## Run it locally

The full local stack starts with one command:

```bash
pnpm install
pnpm dev
```

That starts the control room, local Cloudflare Worker, and Node orchestrator together. No credentials are needed: with no complete set of live keys, the orchestrator automatically replays the deterministic golden run through the same Worker, event stream, findings, and verification UI. Add the values from **[.env.example](.env.example)** to the root `.env` and restart when you want real browser runs.

Open [http://localhost:5173](http://localhost:5173). The bundled golden run is the fastest way to see the product; entering a URL exercises the full local pipeline.

## Public showcase

The public deployment is a static golden-run showcase. It intentionally contains no API keys, Worker, D1 database, R2 bucket, orchestrator, or live scan controls.

Build and preview the same artifact locally:

```bash
pnpm build:demo
pnpm preview:demo
```

For Cloudflare Pages settings, see **[SETUP.md](SETUP.md#deploy-the-static-golden-run-demo-with-cloudflare-pages)**. The build bundles `fixtures/golden-run.json`, so anyone can open the site and see the product story without configuring a backend.

## Screenshots

<table>
  <tr>
    <td><img src="public/readme/pics/friction1.png" alt="Friction landing page with a URL ready to scan" width="100%"></td>
    <td><img src="public/readme/pics/friction3.png" alt="Live site scan with paths, agents, and issue counts" width="100%"></td>
  </tr>
  <tr>
    <td><img src="public/readme/pics/friction4.png" alt="Live annotations showing detected friction on a page" width="100%"></td>
    <td><img src="public/readme/pics/friction5.png" alt="Ranked scan results grouped by severity" width="100%"></td>
  </tr>
</table>

## Architecture

![friction-architecture.png](public/readme/friction-architecture.png)

The full local and live scan stack is split into three runtime pieces:

| Package | Responsibility |
| --- | --- |
| `apps/control-room` | Vite + React interface for scans, live runs, evidence, and reports |
| `apps/orchestrator` | Browser sessions, agent loop, friction detection, fix verification, and GitHub integration |
| `apps/worker` | Hono API, Cloudflare D1 persistence, R2 evidence storage, and server sent events |
| `packages/shared` | Shared contracts, detectors, verification rules, report assembly, and demo fixture |

## Tech stack

`TypeScript` · `React` · `Vite` · `Node.js` · `OpenAI Responses API` · `Browserbase` · `Stagehand` · `Cloudflare Workers` · `D1` · `R2` · `GitHub REST API` · `Playwright`

## Checks

```bash
pnpm typecheck
pnpm test
```

The full local configuration, optional live keys, and static deployment notes are documented in **[SETUP.md](SETUP.md)**.

## License

See [LICENSE](LICENSE).
