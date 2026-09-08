import { setTimeout as delay } from "node:timers/promises";

// A warm worker consumes sequentially, keeping the parser's memory bounded.
// Shutdown interrupts idle/backoff sleeps, but lets an owned document finish.
export async function runWorkerLoop(
  consume: () => Promise<string>,
  signal: AbortSignal,
  onError: () => void,
) {
  let failures = 0;
  while (!signal.aborted) {
    let wait = 0;
    try {
      const result = await consume();
      failures = 0;
      if (result === "empty") wait = 2_000;
    } catch {
      onError();
      wait = Math.min(30_000, 2_000 * 2 ** Math.min(failures++, 4));
    }
    if (wait && !signal.aborted) {
      try { await delay(wait, undefined, { signal }); }
      catch { if (!signal.aborted) throw new Error("Worker wait failed"); }
    }
  }
}
