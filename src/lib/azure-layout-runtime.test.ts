import { afterEach, describe, expect, it, vi } from "vitest";
import { azureLayoutEnabled, azureLayoutEndpoint, checkedOperation } from "./azure-layout-runtime";
afterEach(() => vi.unstubAllEnvs());
describe("Azure layout configuration", () => {
  it("keeps Docling as the default and rejects a mistyped provider", () => {
    vi.stubEnv("DOCUMENT_PARSER", undefined); expect(azureLayoutEnabled()).toBe(false);
    vi.stubEnv("DOCUMENT_PARSER", "azure-layout"); expect(azureLayoutEnabled()).toBe(true);
    vi.stubEnv("DOCUMENT_PARSER", "azuer"); expect(azureLayoutEnabled).toThrow();
  });
  it("rejects endpoints that could send credentials outside the Azure service", () => {
    for (const url of ["http://example.cognitiveservices.azure.com/", "https://example.cognitiveservices.azure.com.evil.test/", "https://key@example.cognitiveservices.azure.com/", "https://example.cognitiveservices.azure.com/private"]) {
      vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", url); expect(azureLayoutEndpoint).toThrow();
    }
  });
  it("restricts authenticated polling to the same service and layout result path", () => {
    const endpoint = new URL("https://example.cognitiveservices.azure.com/");
    expect(checkedOperation(new URL("/documentintelligence/documentModels/prebuilt-layout/analyzeResults/123", endpoint).href, endpoint).origin).toBe(endpoint.origin);
    expect(() => checkedOperation("https://evil.test/result", endpoint)).toThrow();
    expect(() => checkedOperation(new URL("/other", endpoint).href, endpoint)).toThrow();
  });
});
