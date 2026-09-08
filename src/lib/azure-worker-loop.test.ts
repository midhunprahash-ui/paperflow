import { afterEach, expect, it, vi } from "vitest";
import { runWorkerLoop } from "./azure-worker-loop";

// Fake the abortable Node timer to inspect waits without wall-clock delays.
vi.mock("node:timers/promises", () => {
  const setTimeout = vi.fn(async () => {});
  return { setTimeout, default: { setTimeout } };
});
import { setTimeout as delay } from "node:timers/promises";
afterEach(() => vi.clearAllMocks());

it("stays alive through empty polls and handles subsequent documents without extra waits", async () => {
  const stop = new AbortController();
  const consume = vi.fn()
    .mockResolvedValueOnce("empty")
    .mockResolvedValueOnce("processed")
    .mockImplementationOnce(async () => { stop.abort(); return "processed"; });
  await runWorkerLoop(consume, stop.signal, vi.fn());
  expect(consume).toHaveBeenCalledTimes(3);
  expect(delay).toHaveBeenCalledTimes(1);
  expect(delay).toHaveBeenCalledWith(2000, undefined, { signal: stop.signal });
});

it("backs off repeated failures with a cap and resets after a successful poll", async () => {
  const stop = new AbortController();
  let calls = 0;
  const onError = vi.fn();
  await runWorkerLoop(async () => {
    calls++;
    if (calls === 7) return "empty";
    if (calls === 9) { stop.abort(); return "empty"; }
    throw new Error("private SDK detail");
  }, stop.signal, onError);
  expect(onError).toHaveBeenCalledTimes(7);
  expect(vi.mocked(delay).mock.calls.map(call => call[0])).toEqual([2000, 4000, 8000, 16000, 30000, 30000, 2000, 2000]);
});

it("finishes its in-flight document but takes no more work after shutdown", async () => {
  const stop = new AbortController();
  let finish!: (value: string) => void;
  const consume = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  let exited = false;
  const worker = runWorkerLoop(consume, stop.signal, vi.fn()).then(() => { exited = true; });
  stop.abort();
  await Promise.resolve();
  expect(exited).toBe(false);
  finish("processed");
  await worker;
  expect(consume).toHaveBeenCalledTimes(1);
  expect(delay).not.toHaveBeenCalled();
});

it("exits cleanly when shutdown interrupts an idle wait", async () => {
  const stop = new AbortController();
  vi.mocked(delay).mockImplementationOnce(async () => { stop.abort(); throw new Error("AbortError"); });
  const consume = vi.fn().mockResolvedValue("empty");
  await expect(runWorkerLoop(consume, stop.signal, vi.fn())).resolves.toBeUndefined();
  expect(consume).toHaveBeenCalledTimes(1);
});
