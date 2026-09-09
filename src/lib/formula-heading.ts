import labels from "./formula-heading-rules.json";

const compact = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const known = Object.entries(labels).flatMap(([label, aliases]) => [label, ...aliases].map(alias => ({ label, key: compact(alias) })));

function sectionNumber(token: string) {
  if (/^\d+$/.test(token)) return Number(token);
  if (!token || !/^M{0,3}(?:CM|CD|D?C{0,3})(?:XC|XL|L?X{0,3})(?:IX|IV|V?I{0,3})$/.test(token)) return;
  const values: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  return [...token].reduce((sum, char, index) => sum + (values[char] < (values[token[index + 1]] ?? 0) ? -values[char] : values[char]), 0);
}

function distance(a: string, b: string) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const next = [i + 1];
    for (let j = 0; j < b.length; j++) next.push(Math.min(next[j] + 1, row[j + 1] + 1, row[j] + Number(a[i] !== b[j])));
    row = next;
  }
  return row[b.length];
}

// Only text/font wrappers are permitted. Operators, scripts, fractions and
// unknown macros must stay mathematical, even if they contain a heading word.
export function formulaHeading(latex: string, previousHeading?: string): string | undefined {
  if (latex.length > 256) return;
  const plain = latex.replace(/\\(?:mathrm|mathbf|mathit|text|textrm|textbf|textit)\s*\{([^{}]*)\}/g, "$1").trim();
  if (!/^[A-Za-z\d\s.()]+$/.test(plain)) return;
  const match = plain.match(/^\s*((?:[IVXLCDM]\s*)+|[A-Z]|\d+(?:\.\d+)*)\s*[.)]\s*(.+)$/);
  if (match) match[1] = match[1].replace(/\s+/g, "");
  const key = compact(match?.[2] ?? plain);
  let label = known.find(entry => entry.key === key)?.label;
  if (!label && match && key.length >= 10) {
    const previous = previousHeading?.trim().match(/^([IVXLCDM]+|\d+)[.)]\s/);
    const before = previous ? sectionNumber(previous[1]) : undefined;
    const current = sectionNumber(match[1]);
    // OCR spelling repair requires the next section number plus one unique,
    // close vocabulary match. Never apply this fuzzy rule to general prose.
    if (before !== undefined && current === before + 1) {
      const candidates = known.filter(entry => entry.key.startsWith(key.slice(0, 3)) && entry.key.endsWith(key.slice(-3)))
        .map(entry => ({ ...entry, distance: distance(key, entry.key) })).filter(entry => entry.distance <= 3);
      const best = Math.min(...candidates.map(entry => entry.distance));
      const winners = new Set(candidates.filter(entry => entry.distance === best).map(entry => entry.label));
      if (winners.size === 1) label = [...winners][0];
    }
  }
  return label ? (match ? `${match[1]}. ${label}` : label) : undefined;
}
