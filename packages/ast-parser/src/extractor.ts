import { deterministicNodeId, QualifiedName } from './identity.js';
import type { ASTEdge, ASTNode, ExtractResult, NodeType } from './types.js';

interface WalkContext {
  orgId: string;
  repoId: string;
  commitHash: string;
  filePath: string;
  fileId: string;
  nodes: ASTNode[];
  edges: ASTEdge[];
}

/**
 * Tree-sitter is a native dependency that may not be compiled in every
 * environment. We import it lazily; if it is unavailable we transparently fall
 * back to {@link liteExtract}, a dependency-free regex extractor that produces
 * the same node/edge shape (lower fidelity, but enough to populate the graph).
 */
async function loadTreeSitter(): Promise<{ Parser: any; lang: any } | null> {
  try {
    const Parser = (await import('tree-sitter')).default;
    const TypeScript = (await import('tree-sitter-typescript')).default as any;
    return { Parser, lang: TypeScript.typescript };
  } catch {
    return null;
  }
}

export async function extractFromFile(
  orgId: string,
  repoId: string,
  commitHash: string,
  filePath: string,
  content: string,
): Promise<ExtractResult> {
  const ts = await loadTreeSitter();
  if (!ts) return liteExtract(orgId, repoId, commitHash, filePath, content);

  const parser = new ts.Parser();
  parser.setLanguage(ts.lang);
  const tree = parser.parse(content);

  const nodes: ASTNode[] = [];
  const edges: ASTEdge[] = [];

  const fileQN = QualifiedName.file(filePath);
  const fileId = deterministicNodeId(orgId, repoId, fileQN);
  nodes.push({
    id: fileId,
    orgId,
    repoId,
    commitHash,
    nodeType: 'file',
    name: filePath.split('/').pop()!,
    qualifiedName: fileQN,
    filePath,
    lineStart: 1,
    lineEnd: content.split('\n').length,
    language: 'typescript',
  });

  walkTree(tree.rootNode, { orgId, repoId, commitHash, filePath, fileId, nodes, edges });
  return { nodes, edges };
}

function walkTree(node: any, ctx: WalkContext): void {
  switch (node.type) {
    case 'class_declaration':
      handleNamed(node, ctx, 'class');
      break;
    case 'interface_declaration':
      handleNamed(node, ctx, 'interface');
      break;
    case 'function_declaration':
      handleNamed(node, ctx, 'function');
      break;
    case 'enum_declaration':
      handleNamed(node, ctx, 'enum');
      break;
    case 'method_definition':
      handleNamed(node, ctx, 'method');
      break;
    case 'call_expression':
      handleCall(node, ctx);
      break;
    case 'import_statement':
      handleImport(node, ctx);
      break;
  }
  for (const child of node.children ?? []) walkTree(child, ctx);
}

function pushEntity(ctx: WalkContext, type: NodeType, name: string, node: any): string {
  const qn =
    type === 'method'
      ? QualifiedName.method(ctx.filePath, 'anon', name)
      : `${ctx.filePath}::${name}`;
  const id = deterministicNodeId(ctx.orgId, ctx.repoId, qn);
  ctx.nodes.push({
    id,
    orgId: ctx.orgId,
    repoId: ctx.repoId,
    commitHash: ctx.commitHash,
    nodeType: type,
    name,
    qualifiedName: qn,
    filePath: ctx.filePath,
    lineStart: (node.startPosition?.row ?? 0) + 1,
    lineEnd: (node.endPosition?.row ?? 0) + 1,
    language: 'typescript',
    complexity: estimateComplexity(node.text ?? ''),
  });
  ctx.edges.push({ orgId: ctx.orgId, repoId: ctx.repoId, fromNode: ctx.fileId, toNode: id, edgeType: 'CONTAINS' });
  return id;
}

function handleNamed(node: any, ctx: WalkContext, type: NodeType): void {
  const nameNode = node.childForFieldName?.('name');
  const name = nameNode?.text;
  if (name) pushEntity(ctx, type, name, node);
}

function handleCall(node: any, ctx: WalkContext): void {
  const fn = node.childForFieldName?.('function');
  const calleeName = fn?.text?.split('.').pop();
  if (!calleeName) return;
  const toQN = `${ctx.filePath}::${calleeName}`;
  const toId = deterministicNodeId(ctx.orgId, ctx.repoId, toQN);
  ctx.edges.push({ orgId: ctx.orgId, repoId: ctx.repoId, fromNode: ctx.fileId, toNode: toId, edgeType: 'CALLS' });
}

function handleImport(node: any, ctx: WalkContext): void {
  const source = node.childForFieldName?.('source')?.text?.replace(/['"]/g, '');
  if (!source) return;
  ctx.edges.push({
    orgId: ctx.orgId,
    repoId: ctx.repoId,
    fromNode: ctx.fileId,
    toNode: deterministicNodeId(ctx.orgId, ctx.repoId, source),
    edgeType: 'IMPORTS',
    metadata: { source },
  });
}

/** Rough cyclomatic complexity: 1 + number of branch/loop keywords. */
export function estimateComplexity(code: string): number {
  const matches = code.match(/\b(if|for|while|case|catch|&&|\|\||\?)\b/g);
  return 1 + (matches?.length ?? 0);
}

/**
 * Dependency-free fallback extractor. Recognises top-level TS declarations via
 * regex. Used when tree-sitter native bindings are not available.
 */
export function liteExtract(
  orgId: string,
  repoId: string,
  commitHash: string,
  filePath: string,
  content: string,
): ExtractResult {
  const fileQN = QualifiedName.file(filePath);
  const fileId = deterministicNodeId(orgId, repoId, fileQN);
  const lines = content.split('\n');
  const nodes: ASTNode[] = [
    {
      id: fileId,
      orgId,
      repoId,
      commitHash,
      nodeType: 'file',
      name: filePath.split('/').pop()!,
      qualifiedName: fileQN,
      filePath,
      lineStart: 1,
      lineEnd: lines.length,
      language: 'typescript',
    },
  ];
  const edges: ASTEdge[] = [];

  const patterns: Array<[RegExp, NodeType]> = [
    [/^\s*export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_]+)/, 'class'],
    [/^\s*export\s+interface\s+([A-Za-z0-9_]+)/, 'interface'],
    [/^\s*export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/, 'function'],
    [/^\s*export\s+enum\s+([A-Za-z0-9_]+)/, 'enum'],
    [/^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/, 'function'],
  ];

  lines.forEach((line, i) => {
    for (const [re, type] of patterns) {
      const m = re.exec(line);
      if (m?.[1]) {
        const qn = `${filePath}::${m[1]}`;
        const id = deterministicNodeId(orgId, repoId, qn);
        nodes.push({
          id,
          orgId,
          repoId,
          commitHash,
          nodeType: type,
          name: m[1],
          qualifiedName: qn,
          filePath,
          lineStart: i + 1,
          lineEnd: i + 1,
          language: 'typescript',
          complexity: estimateComplexity(line),
        });
        edges.push({ orgId, repoId, fromNode: fileId, toNode: id, edgeType: 'CONTAINS' });
        break;
      }
    }
    const imp = /^\s*import\s+.*\s+from\s+['"]([^'"]+)['"]/.exec(line);
    if (imp?.[1]) {
      edges.push({
        orgId,
        repoId,
        fromNode: fileId,
        toNode: deterministicNodeId(orgId, repoId, imp[1]),
        edgeType: 'IMPORTS',
        metadata: { source: imp[1] },
      });
    }
  });

  return { nodes, edges };
}
