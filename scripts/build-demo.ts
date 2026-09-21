import { spawnSync } from "node:child_process";

const packageManager = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(packageManager, ["--filter", "@friction/control-room", "build"], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEMO_MODE: "1" },
  // Windows exposes pnpm as a .cmd shim, which needs the shell to be spawned
  // by Node. The arguments above are fixed repo commands, not user input.
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`[demo] could not start ${packageManager}: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
