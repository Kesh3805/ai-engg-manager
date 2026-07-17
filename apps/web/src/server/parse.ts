import 'server-only';
import { randomUUID } from 'node:crypto';

export type NodeType = 'file' | 'class' | 'interface' | 'function' | 'method' | 'enum';

export interface ParsedNode {
  id: string;
  nodeType: NodeType;
  name: string;
  qn: string;
  filePath: string;
  line: number;
  complexity: number;
}
export interface ParsedEdge {
  id: string;
  from: string;
  to: string;
  type: 'CONTAINS' | 'CALLS' | 'USAGE' | 'IMPLEMENTS';
}

const DECL_PATTERNS: Array<[RegExp, NodeType]> = [
  [/^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/, 'class'],
  [/^\s*export\s+interface\s+([A-Za-z0-9_]+)/, 'interface'],
  [/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/, 'function'],
  [/^\s*export\s+enum\s+([A-Za-z0-9_]+)/, 'enum'],
  [/^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/, 'function'],
  [/^\s*export\s+const\s+([A-Z][A-Za-z0-9_]+)\s*=/, 'function'],
];

const USAGE_DENYLIST = new Set(['next', 'link', 'type', 'props', 'data', 'value', 'name', 'index', 'config', 'main', 'POST', 'GET', 'PUT', 'self', 'this', 'true', 'false', 'null', 'void']);

function complexity(code: string): number {
  return 1 + (code.match(/\b(if|for|while|case|catch)\b|&&|\|\||\?/g)?.length ?? 0);
}

/**
 * Two-pass regex extraction: (1) top-level declarations per file, (2) cross-file
 * CALLS/USAGE/IMPLEMENTS edges derived by scanning each file for references to
 * entities defined elsewhere. Same algorithm as the local ingestion seed.
 */
export function parseProject(files: Array<{ path: string; content: string }>): { nodes: ParsedNode[]; edges: ParsedEdge[] } {
  const nodes: ParsedNode[] = [];
  const fileNodeByPath = new Map<string, ParsedNode>();
  const textByPath = new Map<string, string>();
  const seenQn = new Set<string>(); // qualified_name is unique per (repo) — dedupe collisions

  for (const { path, content } of files) {
    if (seenQn.has(path)) continue; // duplicate file path (case-insensitive collisions etc.)
    textByPath.set(path, content);
    const fileNode: ParsedNode = { id: randomUUID(), nodeType: 'file', name: path.split('/').pop()!, qn: path, filePath: path, line: 1, complexity: 1 };
    nodes.push(fileNode);
    fileNodeByPath.set(path, fileNode);
    seenQn.add(path);

    content.split('\n').forEach((line, i) => {
      for (const [re, type] of DECL_PATTERNS) {
        const m = re.exec(line);
        if (m?.[1]) {
          const qn = `${path}::${m[1]}`;
          if (!seenQn.has(qn)) {
            seenQn.add(qn);
            nodes.push({ id: randomUUID(), nodeType: type, name: m[1], qn, filePath: path, line: i + 1, complexity: complexity(line) });
          }
          break;
        }
      }
    });
  }

  const edges: ParsedEdge[] = [];
  // CONTAINS: file -> entity
  for (const n of nodes) {
    if (n.nodeType === 'file') continue;
    const f = fileNodeByPath.get(n.filePath);
    if (f) edges.push({ id: randomUUID(), from: f.id, to: n.id, type: 'CONTAINS' });
  }

  // Cross-file usage edges
  const entityIndex = nodes.filter((n) => n.nodeType !== 'file' && n.name.length >= 4 && !USAGE_DENYLIST.has(n.name));
  for (const [filePath, text] of textByPath) {
    const f = fileNodeByPath.get(filePath)!;
    const seen = new Set<string>();
    for (const e of entityIndex) {
      if (e.filePath === filePath || seen.has(e.id)) continue;
      const isCall = new RegExp(`\\b${e.name}\\s*[(<]`).test(text) || new RegExp(`new\\s+${e.name}\\b`).test(text);
      const isImpl = new RegExp(`(implements|extends)\\s+[^\\n]*\\b${e.name}\\b`).test(text);
      const isPascal = /^[A-Z]/.test(e.name);
      if (!isCall && !isImpl && !(isPascal && new RegExp(`\\b${e.name}\\b`).test(text))) continue;
      edges.push({ id: randomUUID(), from: f.id, to: e.id, type: isImpl ? 'IMPLEMENTS' : isCall ? 'CALLS' : 'USAGE' });
      seen.add(e.id);
    }
  }

  // de-dupe edges
  const seenEdge = new Set<string>();
  const deduped = edges.filter((e) => {
    const k = `${e.from}|${e.to}|${e.type}`;
    if (seenEdge.has(k)) return false;
    seenEdge.add(k);
    return true;
  });

  return { nodes, edges: deduped };
}
