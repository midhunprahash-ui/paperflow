import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { QueueClient } from "@azure/storage-queue";
import { processDoclingDocument, runParameters } from "./docling-processing";
import { queuedDocumentSchema, type QueuedDocument } from "./azure-docling-queue";

const VISIBILITY_SECONDS = 1800;

async function jobState(admin: SupabaseClient, message: QueuedDocument) {
  const { data, error } = await admin.from("processing_jobs").select("status")
    .eq("id", message.jobId).eq("document_id", message.documentId).eq("owner_id", message.ownerId).maybeSingle();
  if (error) throw new Error("Could not read processing state");
  return data?.status as string | undefined;
}

// Never acknowledge an unconfirmed result.
// Visibility exceeds the parser deadline; a killed execution can be reclaimed
// using the existing five-minute Postgres lease after the message reappears.
export async function consumeDoclingMessage(admin: SupabaseClient, queue: QueueClient, poison: QueueClient) {
  const response = await queue.receiveMessages({ numberOfMessages: 1, visibilityTimeout: VISIBILITY_SECONDS });
  const message = response.receivedMessageItems[0];
  if (!message) return "empty";
  const acknowledge = () => queue.deleteMessage(message.messageId, message.popReceipt);
  let payload: QueuedDocument;
  try { payload = queuedDocumentSchema.parse(JSON.parse(message.messageText)); }
  catch {
    // Retain malformed messages for operator inspection, never log their bodies.
    await poison.sendMessage(message.messageText, { messageTimeToLive: -1 });
    await acknowledge();
    return "quarantined";
  }

  const state = await jobState(admin, payload);
  if (!state || state === "ready" || state === "failed") {
    await acknowledge();
    return "finished";
  }
  const { data: document, error: documentError } = await admin.from("documents").select("id")
    .eq("id", payload.documentId).eq("owner_id", payload.ownerId).is("deleted_at", null).maybeSingle();
  if (documentError) throw new Error("Could not read document state");
  if (!document) { await acknowledge(); return "deleted"; }

  const run = { ...payload, runId: randomUUID() };
  const { data: claim, error } = await admin.rpc("claim_docling_job", runParameters(run));
  if (error) throw new Error("Could not claim processing job");
  if (claim === "processing") {
    // Another execution owns it. Keep this delivery as a recovery opportunity.
    await queue.updateMessage(message.messageId, message.popReceipt, undefined, 330);
    return "busy";
  }
  if (claim === "ready") { await acknowledge(); return "finished"; }
  if (claim !== "claimed") throw new Error("Unexpected processing claim");
  if (message.dequeueCount > 5) {
    // Only the owner of the fresh lease may fail an exhausted attempt.
    await poison.sendMessage(message.messageText, { messageTimeToLive: -1 });
    const { error: failure } = await admin.rpc("fail_docling_job", {
      ...runParameters(run), p_message: "Processing was interrupted repeatedly. Please retry from the library.",
    });
    if (failure) throw new Error("Could not record exhausted processing attempt");
  } else {
    await processDoclingDocument(admin, run);
  }
  const finalState = await jobState(admin, payload);
  if (finalState && finalState !== "ready" && finalState !== "failed") {
    throw new Error("Processing outcome is not confirmed; retaining queue message");
  }
  await acknowledge();
  return "processed";
}

// Drain obsolete deliveries within one warm execution instead of paying a
// container startup for every duplicate. Process at most one real paper so the
// parser retains the existing execution timeout and memory bounds.
export async function drainDoclingQueue(admin: SupabaseClient, queue: QueueClient, poison: QueueClient) {
  const deadline = Date.now() + 60_000;
  const counts = { processed: 0, discarded: 0, deferred: 0 };
  for (let received = 0; received < 100 && Date.now() < deadline; received++) {
    const result = await consumeDoclingMessage(admin, queue, poison);
    if (result === "empty") break;
    if (result === "processed") { counts.processed++; break; }
    if (result === "busy") counts.deferred++;
    else counts.discarded++;
  }
  return counts;
}
