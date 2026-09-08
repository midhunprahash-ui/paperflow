import { build } from "esbuild";

await build({
  entryPoints: ["scripts/azure-worker.ts"],
  outfile: "dist/azure-worker.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // This entrypoint runs only in a worker container, never in a browser.
  alias: { "server-only": "./node_modules/next/dist/compiled/server-only/empty.js" },
});
