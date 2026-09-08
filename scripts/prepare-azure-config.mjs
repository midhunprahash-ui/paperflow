import { mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { parseEnv } from "node:util";
import path from "node:path";

// Produce local, ignored ARM request bodies. Never print secret-bearing bodies.
const configPath = process.argv[2];
if (!configPath) throw new Error("Pass the local Azure deployment metadata JSON path");
const deployment = JSON.parse(readFileSync(configPath, "utf8"));
const env = parseEnv(readFileSync(".env.local", "utf8"));
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
  if (!env[key]) throw new Error(`Missing ${key}`);
}
for (const key of ["region", "environmentId", "registry", "storageAccount", "siteUrl", "webName", "workerName", "webIdentity", "webClientId", "workerIdentity", "workerClientId", "imageTag"]) {
  if (typeof deployment[key] !== "string" || !deployment[key]) throw new Error(`Missing ${key}`);
}
const identity = id => ({ type: "UserAssigned", userAssignedIdentities: { [id]: {} } });
const sharedEnv = clientId => [
  { name: "NEXT_PUBLIC_SUPABASE_URL", value: env.NEXT_PUBLIC_SUPABASE_URL },
  { name: "SUPABASE_SECRET_KEY", secretRef: "supabase-server-key" },
  { name: "AZURE_STORAGE_QUEUE_URL", value: `https://${deployment.storageAccount}.queue.core.windows.net` },
  { name: "AZURE_DOCLING_QUEUE_NAME", value: "docling" },
  { name: "AZURE_CLIENT_ID", value: clientId },
];
const secrets = [{ name: "supabase-server-key", value: env.SUPABASE_SECRET_KEY }];
const registries = id => [{ server: deployment.registry, identity: id }];
const web = {
  location: deployment.region,
  identity: identity(deployment.webIdentity),
  tags: { app: "rpaper", environment: "staging" },
  properties: {
    managedEnvironmentId: deployment.environmentId,
    workloadProfileName: "Consumption",
    configuration: {
      activeRevisionsMode: "Single", secrets, registries: registries(deployment.webIdentity),
      ingress: { external: true, targetPort: 3000, transport: "auto", allowInsecure: false,
        ...(deployment.customDomains ? { customDomains: deployment.customDomains } : {}),
        traffic: [{ latestRevision: true, weight: 100 }] },
    },
    template: {
      containers: [{
        name: "web", image: `${deployment.registry}/rpaper-web:${deployment.imageTag}`,
        resources: { cpu: 1, memory: "2Gi" },
        env: [...sharedEnv(deployment.webClientId),
          { name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", value: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
          { name: "NEXT_PUBLIC_SITE_URL", value: deployment.siteUrl },
          { name: "SITE_URL", value: deployment.siteUrl },
          { name: "AUTH_REDIRECT_ORIGINS", value: deployment.authRedirectOrigins ?? deployment.azureDefaultSiteUrl ?? deployment.siteUrl }],
        probes: [
          { type: "Startup", httpGet: { path: "/", port: 3000 }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 10 },
          { type: "Readiness", httpGet: { path: "/", port: 3000 }, periodSeconds: 10, timeoutSeconds: 5, failureThreshold: 3 },
        ],
      }],
      scale: { minReplicas: 0, maxReplicas: 1, rules: [{ name: "http", http: { metadata: { concurrentRequests: "10" } } }] },
    },
  },
};
const azureLayout = deployment.documentParser === "azure-layout";
if (azureLayout && !deployment.documentIntelligenceEndpoint) throw new Error("Missing documentIntelligenceEndpoint");
const worker = {
  location: deployment.region,
  identity: identity(deployment.workerIdentity),
  tags: { app: "rpaper", environment: "staging" },
  properties: {
    environmentId: deployment.environmentId,
    workloadProfileName: "Consumption",
    configuration: {
      triggerType: "Event", replicaTimeout: 1500, replicaRetryLimit: 0,
      secrets, registries: registries(deployment.workerIdentity),
      eventTriggerConfig: {
        parallelism: 1, replicaCompletionCount: 1,
        scale: { minExecutions: 0, maxExecutions: 1, pollingInterval: azureLayout ? 10 : 60, rules: [{
          name: "docling-queue", type: "azure-queue", identity: deployment.workerIdentity,
          metadata: { accountName: deployment.storageAccount, queueName: "docling", queueLength: "1" },
        }] },
      },
    },
    template: { containers: [{
      name: "worker", image: `${deployment.registry}/rpaper-worker:${deployment.workerImageTag ?? deployment.imageTag}`,
      resources: azureLayout ? { cpu: 1, memory: "2Gi" } : { cpu: 4, memory: "8Gi" },
      env: [...sharedEnv(deployment.workerClientId), ...(azureLayout ? [
        { name: "DOCUMENT_PARSER", value: "azure-layout" },
        { name: "AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", value: deployment.documentIntelligenceEndpoint },
      ] : [])],
    }] },
  },
};
// Continuous Azure Layout worker: no HTTP endpoint, one warm replica. Keep the
// event-job artifact for rollback; do not run both consumers as the steady state.
const warmWorker = {
  location: deployment.region,
  identity: identity(deployment.workerIdentity),
  tags: { app: "rpaper", environment: "staging" },
  properties: {
    managedEnvironmentId: deployment.environmentId,
    workloadProfileName: "Consumption",
    configuration: {
      activeRevisionsMode: "Single", secrets, registries: registries(deployment.workerIdentity),
    },
    template: {
      terminationGracePeriodSeconds: 600,
      containers: worker.properties.template.containers.map(container => ({
        ...container,
        env: [...container.env, { name: "AZURE_WORKER_MODE", value: "continuous" }],
      })),
      scale: { minReplicas: 1, maxReplicas: 1 },
    },
  },
};
if (azureLayout && deployment.warmWorkerName) {
  // Retain a manual one-shot job as a fallback, without an event scaler racing
  // the warm app or launching unnecessary containers for the same queue.
  worker.properties.configuration.triggerType = "Manual";
  delete worker.properties.configuration.eventTriggerConfig;
  worker.properties.configuration.manualTriggerConfig = { parallelism: 1, replicaCompletionCount: 1 };
}
const directory = "tmp/azure-deploy";
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
for (const [name, value] of Object.entries({ web, worker, ...(azureLayout ? { "warm-worker": warmWorker } : {}) })) {
  const destination = path.join(directory, `${name}.json`);
  writeFileSync(destination, JSON.stringify(value), { mode: 0o600 });
  chmodSync(destination, 0o600);
}
console.log("Prepared private Azure request files in tmp/azure-deploy");
