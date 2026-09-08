import { createClient } from "@supabase/supabase-js";
import { createDoclingQueue } from "../src/lib/azure-docling-queue";
import { consumeDoclingMessage, drainDoclingQueue } from "../src/lib/azure-docling-worker";
import { runWorkerLoop } from "../src/lib/azure-worker-loop";
import { requireDocling } from "../src/lib/docling-runtime";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Missing worker configuration");
  await requireDocling();
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const queue = createDoclingQueue();
  const poison = createDoclingQueue(true);
  if (process.env.AZURE_WORKER_MODE === "continuous") {
    const shutdown = new AbortController();
    const stop = () => {
      console.log("Worker stopping after its current document");
      shutdown.abort();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    console.log("Warm document worker ready");
    try {
      await runWorkerLoop(async () => {
        const result = await consumeDoclingMessage(admin, queue, poison);
        if (result !== "empty") console.log("Document delivery handled", { result });
        return result;
      }, shutdown.signal, () => {
        console.error("Worker delivery failed; backing off with unacknowledged messages retained.");
      });
    } finally {
      process.removeListener("SIGTERM", stop);
      process.removeListener("SIGINT", stop);
    }
    return;
  }
  const result = await drainDoclingQueue(admin, queue, poison);
  console.log("Docling execution completed", { result });
}

void main().catch(() => {
  // SDK exception objects may contain request headers. Do not log them.
  console.error("Docling worker failed; unacknowledged messages remain available for retry.");
  process.exitCode = 1;
});
