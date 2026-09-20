import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    // happy-dom has no document.evaluate at all; see src/test/xpathPolyfill.ts.
    setupFiles: ["./src/test/xpathPolyfill.ts"],
  },
});
