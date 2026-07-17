export type NodeType =
  | 'file'
  | 'folder'
  | 'class'
  | 'interface'
  | 'function'
  | 'method'
  | 'enum'
  | 'enum_member'
  | 'variable'
  | 'decorator';

export type EdgeType =
  | 'CONTAINS'
  | 'CALLS'
  | 'USAGE'
  | 'IMPORTS'
  | 'IMPLEMENTS'
  | 'INHERITS'
  | 'EXPORTS'
  | 'DECORATES';

export interface ASTNode {
  id: string;
  orgId: string;
  repoId: string;
  commitHash: string;
  nodeType: NodeType;
  name: string;
  qualifiedName: string;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  byteStart?: number;
  byteEnd?: number;
  language?: string;
  signature?: string | null;
  returnType?: string | null;
  complexity?: number | null;
  metadata?: Record<string, unknown>;
}

export interface ASTEdge {
  orgId: string;
  repoId: string;
  fromNode: string;
  toNode: string;
  edgeType: EdgeType;
  metadata?: Record<string, unknown>;
}

export interface ExtractResult {
  nodes: ASTNode[];
  edges: ASTEdge[];
}
