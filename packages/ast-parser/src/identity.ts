import { v5 as uuidv5 } from 'uuid';

const AST_NAMESPACE = process.env.AST_UUID_NAMESPACE ?? '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Canonical qualified-name builders. The qualified name is the stable identity
 * key for a code entity — re-parsing the same entity yields the same name and
 * therefore (via UUIDv5) the same node id, making ingestion idempotent.
 */
export const QualifiedName = {
  file: (filePath: string) => filePath,
  class: (filePath: string, name: string) => `${filePath}::${name}`,
  interface: (filePath: string, name: string) => `${filePath}::${name}`,
  function: (filePath: string, name: string) => `${filePath}::${name}`,
  method: (filePath: string, className: string, methodName: string) =>
    `${filePath}::${className}.${methodName}`,
  enum: (filePath: string, name: string) => `${filePath}::${name}`,
  enumMember: (filePath: string, enumName: string, member: string) =>
    `${filePath}::${enumName}.${member}`,
  /** Overloaded methods append a param-type signature to stay unique. */
  methodOverload: (filePath: string, className: string, methodName: string, paramTypes: string[]) =>
    `${filePath}::${className}.${methodName}(${paramTypes.join(',')})`,
} as const;

export function deterministicNodeId(orgId: string, repoId: string, qualifiedName: string): string {
  return uuidv5(`${orgId}:${repoId}:${qualifiedName}`, AST_NAMESPACE);
}
