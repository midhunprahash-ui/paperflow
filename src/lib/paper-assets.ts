import type { PaperDocument } from "./types/document";

export function manifestAssetPaths(paper: PaperDocument, manifestPath: string): string[] {
  const root = manifestPath.slice(0, manifestPath.lastIndexOf("/") + 1);
  const paths = Object.values(paper.assets ?? {}).map(asset => asset.path);
  if (paths.length > 4096 || paths.some(path => !path.startsWith(root) || path.slice(root.length).split("/").some(part => !part || part === ".." || part === ".") || path.includes("\\") || path.includes("%"))) {
    throw new Error("Invalid document asset ownership");
  }
  return [...new Set(paths)];
}
