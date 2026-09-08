import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([".next/**", ".next-docling/**", "dist/**", "tmp/**", "worker/**", "supabase/**", "docling-lab/.venv/**", "docling-lab/outputs/**", "docling-lab/inputs/**"]),
]);
