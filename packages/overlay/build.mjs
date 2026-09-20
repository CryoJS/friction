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
const LIMIT = 25 * 1024;

await mkdir("dist", { recursive: true });

const result = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  keepNames: false,
  format: "iife",
  target: "es2020",
  define: { WORKER_ORIGIN: JSON.stringify(WORKER_ORIGIN) },
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
