/**
 * Builds the overlay twice: a minified IIFE, and that IIFE wrapped as a
 * javascript: URL for the bookmarks bar.
 *
 * keepNames is off on purpose. tsx's esbuild turns it ON, which wraps every
 * function in a __name() helper that does not exist in a remote page -- the
 * reason apps/orchestrator/src/pageScripts.ts is written as strings. This
 * package has its own build, so it can be real TypeScript.
 */
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const WORKER_ORIGIN = process.env.WORKER_ORIGIN ?? "http://localhost:8787";
// apps/control-room's dev port (see apps/control-room/package.json). The
// 404 panel links here rather than to WORKER_ORIGIN, which only serves raw
// JSON -- a real deploy sets this via env, same as WORKER_ORIGIN.
const CONTROL_ROOM_ORIGIN = process.env.CONTROL_ROOM_ORIGIN ?? "http://localhost:5173";
// Raised from 25KB to 32KB in fix round 2: the zero-dependency discipline
// this cap existed to force is proven (zod stays out entirely, see
// packages/shared/src/overlayVersion.ts), so the original number was a
// conservative guess rather than a real constraint. 32KB is still well
// inside the ~64KB the spec assumed the most restrictive browser allows for
// a javascript: URL, and leaves room for Task 12 to wire a real
// offline-bookmarklet link into main.ts. Applies ONLY to this bookmarklet --
// Task 12's offline bundle inlines scan data, is not URL-encoded, and must
// not be measured against it.
const LIMIT = 32 * 1024;

await mkdir("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  keepNames: false,
  format: "iife",
  target: "es2020",
  define: { WORKER_ORIGIN: JSON.stringify(WORKER_ORIGIN), CONTROL_ROOM_ORIGIN: JSON.stringify(CONTROL_ROOM_ORIGIN) },
  write: false,
});

const code = result.outputFiles[0].text;
await writeFile("dist/overlay.iife.js", code);

const bookmarklet = `javascript:${encodeURIComponent(code)}`;
await writeFile("dist/bookmarklet.txt", bookmarklet);

console.log(`overlay ${(code.length / 1024).toFixed(1)} KB, bookmarklet ${(bookmarklet.length / 1024).toFixed(1)} KB`);
if (bookmarklet.length > LIMIT) {
  console.error(`bookmarklet is ${bookmarklet.length} bytes; the cap is ${LIMIT}`);
  process.exit(1);
}
