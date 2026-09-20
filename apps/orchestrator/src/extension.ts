/**
 * The second way a candidate patch can reach the page: as a Chrome MV3
 * extension installed into the Browserbase session at create time, instead of
 * page.addInitScript() (verify.ts, FRICTION_EXTENSION_INJECT=1).
 *
 * The zip is built in memory, uploaded to Browserbase's Extensions API, and the
 * returned id is passed to sessions.create as a TOP-LEVEL extensionId.
 *
 * The content script declares world: "MAIN". Without it the patch runs in an
 * isolated world, cannot touch the page's own JS, and fails silently.
 *
 * Uploads are cached per (patch, origin) for the life of the process, so the
 * retry of a verification reuses one extension. Everything uploaded is deleted
 * best-effort at the end of a scan (cleanupPatchExtensions).
 */
import Browserbase from "@browserbasehq/sdk";
import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { config } from "./config";
import { errorMessage, log } from "./util";

const API_BASE = "https://api.browserbase.com/v1/extensions";

/** sha256(patchJs + targetOrigin) -> the in-flight or settled upload. */
const uploads = new Map<string, Promise<string>>();

/** What cleanupPatchExtensions deletes. */
const uploaded = new Set<string>();

/** The minimal SDK surface this file uses, if this SDK version has it at all. */
interface ExtensionsResource {
  create?: (body: { file: unknown }) => Promise<{ id: string }>;
  delete?: (id: string) => Promise<unknown>;
}

function extensionsResource(apiKey: string): ExtensionsResource | null {
  const bb = new Browserbase({ apiKey, maxRetries: 2, timeout: 30_000 }) as unknown as { extensions?: ExtensionsResource };
  return bb.extensions ?? null;
}

function zipPatch(patchJs: string, targetOrigin: string): Uint8Array {
  const manifest = {
    manifest_version: 3,
    name: "friction-patch",
    version: "1.0",
    content_scripts: [
      {
        matches: [`${targetOrigin.replace(/\/+$/, "")}/*`],
        js: ["patch.js"],
        run_at: "document_start",
        world: "MAIN",
      },
    ],
  };
  return zipSync({ "manifest.json": strToU8(JSON.stringify(manifest, null, 2)), "patch.js": strToU8(patchJs) });
}

async function upload(zip: Uint8Array, apiKey: string): Promise<string> {
  const file = new File([zip as BlobPart], "friction-patch.zip", { type: "application/zip" });
  const extensions = extensionsResource(apiKey);
  if (extensions?.create) return (await extensions.create({ file })).id;

  // Older SDKs have no extensions resource: the same multipart upload by hand.
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(API_BASE, { method: "POST", headers: { "X-BB-API-Key": apiKey }, body: form });
  if (!response.ok) throw new Error(`extension upload failed: ${response.status} ${await response.text().catch(() => "")}`.trim());
  const body = (await response.json()) as { id?: string };
  if (!body.id) throw new Error("extension upload returned no id");
  return body.id;
}

/**
 * Package `patchJs` as an extension that runs at document_start on
 * `targetOrigin`, upload it, and return its extensionId.
 */
export function buildAndUploadPatchExtension(patchJs: string, targetOrigin: string): Promise<string> {
  // Mock mode never touches a Browserbase API.
  if (config.mode === "mock") return Promise.reject(new Error("extension injection is not available in mock mode"));
  const apiKey = config.browserbaseApiKey;
  if (!apiKey) return Promise.reject(new Error("BROWSERBASE_API_KEY is not set"));

  const key = createHash("sha256").update(`${patchJs}\n${targetOrigin}`).digest("hex");
  const cached = uploads.get(key);
  if (cached) return cached;

  const pending = upload(zipPatch(patchJs, targetOrigin), apiKey).then((id) => {
    uploaded.add(id);
    log("verify", `patch extension ${id} uploaded for ${targetOrigin}`);
    return id;
  });
  // A failed upload is not cached: the next run may as well try again.
  pending.catch(() => uploads.delete(key));
  uploads.set(key, pending);
  return pending;
}

/** Best effort: failures are logged and ignored, and the cache is cleared either way. */
export async function cleanupPatchExtensions(): Promise<void> {
  const ids = [...uploaded];
  uploaded.clear();
  uploads.clear();
  const apiKey = config.browserbaseApiKey;
  if (ids.length === 0 || !apiKey) return;
  const extensions = extensionsResource(apiKey);
  for (const id of ids) {
    try {
      if (extensions?.delete) await extensions.delete(id);
      else {
        const response = await fetch(`${API_BASE}/${id}`, { method: "DELETE", headers: { "X-BB-API-Key": apiKey } });
        if (!response.ok) throw new Error(`${response.status}`);
      }
    } catch (err) {
      log("verify", `could not delete patch extension ${id}: ${errorMessage(err)}`);
    }
  }
}
