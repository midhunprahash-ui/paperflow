import katex from "katex";

export function renderMath(latex: string, displayMode: boolean) {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: true, trust: false, strict: "error", output: "htmlAndMathml", maxExpand: 1000, maxSize: 20 });
  } catch {
    return null;
  }
}
