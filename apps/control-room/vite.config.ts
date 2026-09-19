import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // @friction/shared/golden imports ../../fixtures/golden-run.json, which
    // lives above this app's root. Allow the whole monorepo.
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
});
