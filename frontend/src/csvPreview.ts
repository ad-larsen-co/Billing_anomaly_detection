/** Parse CSV text for Overview preview (no server round-trip). */

const MAX_PREVIEW_ROWS = 200;

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export function parseCsvForPreview(text: string): {
  rows: Record<string, unknown>[];
  totalRows: number;
} | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  const headers = parseCsvLine(lines[0]).map((h) => h.trim());
  if (!headers.length || headers.every((h) => !h)) return null;

  const dataLines = lines.slice(1);
  const totalRows = dataLines.length;
  const capped = dataLines.slice(0, MAX_PREVIEW_ROWS);
  const rows: Record<string, unknown>[] = [];
  for (const line of capped) {
    const cells = parseCsvLine(line);
    const row: Record<string, unknown> = {};
    headers.forEach((h, j) => {
      row[h] = cells[j] ?? "";
    });
    rows.push(row);
  }
  return { rows, totalRows };
}
