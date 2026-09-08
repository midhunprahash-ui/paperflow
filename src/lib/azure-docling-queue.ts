import "server-only";
import { DefaultAzureCredential } from "@azure/identity";
import { QueueClient } from "@azure/storage-queue";
import { z } from "zod";

// Messages contain identifiers only. The worker rechecks ownership in Postgres.
export const queuedDocumentSchema = z.object({
  version: z.literal(1),
  documentId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  jobId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ownerId: z.uuid(),
}).strict();
export type QueuedDocument = z.infer<typeof queuedDocumentSchema>;

export function azureDoclingEnabled() {
  const mode = process.env.DOCLING_DISPATCH_MODE ?? "local";
  if (mode !== "local" && mode !== "azure-queue") throw new Error("Invalid Docling dispatch mode");
  return mode === "azure-queue";
}

export function createDoclingQueue(poison = false) {
  const name = process.env.AZURE_DOCLING_QUEUE_NAME ?? "docling";
  const url = process.env.AZURE_STORAGE_QUEUE_URL;
  if (!url || !/^https:\/\/[^/]+\.queue\.core\.windows\.net\/?$/.test(url)) {
    throw new Error("Configure the Azure Queue Storage service URL");
  }
  return new QueueClient(`${url.replace(/\/$/, "")}/${name}${poison ? "-poison" : ""}`, new DefaultAzureCredential());
}

export async function enqueueDoclingDocument(document: QueuedDocument) {
  const body = queuedDocumentSchema.parse(document);
  await createDoclingQueue().sendMessage(JSON.stringify(body), { messageTimeToLive: -1 });
}
