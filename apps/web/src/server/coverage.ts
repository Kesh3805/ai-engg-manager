import 'server-only';

/**
 * Inline coverage parsers (plan §8). Three CI formats, no dependencies.
 * All percentages are 0–100 with two decimals.
 */

export interface FileCoverage {
  filePath: string;
  linePct: number | null;
  branchPct: number | null;
  uncoveredLines: number[];
}

export interface CoverageSummary {
  overallPct: number;
  linePct: number | null;
  branchPct: number | null;
  functionPct: number | null;
  files: FileCoverage[];
}

function pct(covered: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((covered / total) * 10_000) / 100;
}

/** lcov.info: SF/DA/LF/LH/BRF/BRH/FNF/FNH records. */
export function parseLcov(content: string): CoverageSummary {
  const files: FileCoverage[] = [];
  let current: { path: string; uncovered: number[]; lf: number; lh: number; brf: number; brh: number } | null = null;
  let totals = { lf: 0, lh: 0, brf: 0, brh: 0, fnf: 0, fnh: 0 };

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('SF:')) {
      current = { path: line.slice(3).trim(), uncovered: [], lf: 0, lh: 0, brf: 0, brh: 0 };
    } else if (line.startsWith('DA:') && current) {
      const [lineNo, hits] = line.slice(3).split(',');
      if (hits === '0') current.uncovered.push(Number(lineNo));
    } else if (line.startsWith('LF:') && current) current.lf = Number(line.slice(3));
    else if (line.startsWith('LH:') && current) current.lh = Number(line.slice(3));
    else if (line.startsWith('BRF:') && current) current.brf = Number(line.slice(4));
    else if (line.startsWith('BRH:') && current) current.brh = Number(line.slice(4));
    else if (line.startsWith('FNF:')) totals.fnf += Number(line.slice(4));
    else if (line.startsWith('FNH:')) totals.fnh += Number(line.slice(4));
    else if (line === 'end_of_record' && current) {
      totals.lf += current.lf;
      totals.lh += current.lh;
      totals.brf += current.brf;
      totals.brh += current.brh;
      files.push({
        filePath: current.path,
        linePct: pct(current.lh, current.lf),
        branchPct: pct(current.brh, current.brf),
        uncoveredLines: current.uncovered.slice(0, 500),
      });
      current = null;
    }
  }

  const linePct = pct(totals.lh, totals.lf);
  return {
    overallPct: linePct ?? 0,
    linePct,
    branchPct: pct(totals.brh, totals.brf),
    functionPct: pct(totals.fnh, totals.fnf),
    files,
  };
}

/** Cobertura XML — attribute-level parse, no XML dependency. */
export function parseCobertura(content: string): CoverageSummary {
  const rootMatch = /<coverage\b[^>]*>/.exec(content);
  const attr = (tag: string, name: string): number | null => {
    const m = new RegExp(`${name}="([\\d.]+)"`).exec(tag);
    return m ? Number(m[1]) : null;
  };
  const lineRate = rootMatch ? attr(rootMatch[0], 'line-rate') : null;
  const branchRate = rootMatch ? attr(rootMatch[0], 'branch-rate') : null;

  const files: FileCoverage[] = [];
  const classRe = /<class\b[^>]*filename="([^"]+)"[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = classRe.exec(content)) !== null && files.length < 2_000) {
    const fileLineRate = attr(m[0], 'line-rate');
    files.push({
      filePath: m[1]!,
      linePct: fileLineRate === null ? null : Math.round(fileLineRate * 10_000) / 100,
      branchPct: null,
      uncoveredLines: [],
    });
  }

  const linePct = lineRate === null ? null : Math.round(lineRate * 10_000) / 100;
  return {
    overallPct: linePct ?? 0,
    linePct,
    branchPct: branchRate === null ? null : Math.round(branchRate * 10_000) / 100,
    functionPct: null,
    files,
  };
}

interface IstanbulEntry {
  lines?: { pct?: number };
  branches?: { pct?: number };
  functions?: { pct?: number };
}

/** Istanbul json-summary: `{ total: {...}, "<file>": {...} }`. */
export function parseJsonSummary(content: string): CoverageSummary {
  const data = JSON.parse(content) as Record<string, IstanbulEntry>;
  const total = data.total ?? {};
  const files: FileCoverage[] = Object.entries(data)
    .filter(([key]) => key !== 'total')
    .slice(0, 2_000)
    .map(([filePath, entry]) => ({
      filePath,
      linePct: entry.lines?.pct ?? null,
      branchPct: entry.branches?.pct ?? null,
      uncoveredLines: [],
    }));
  return {
    overallPct: total.lines?.pct ?? 0,
    linePct: total.lines?.pct ?? null,
    branchPct: total.branches?.pct ?? null,
    functionPct: total.functions?.pct ?? null,
    files,
  };
}

export function parseCoverage(format: string, content: string): CoverageSummary {
  switch (format) {
    case 'lcov':
      return parseLcov(content);
    case 'cobertura':
      return parseCobertura(content);
    case 'json-summary':
      return parseJsonSummary(content);
    default:
      throw new Error(`unsupported coverage format: ${format}`);
  }
}
