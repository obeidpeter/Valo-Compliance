import * as api from "@workspace/api-zod";
import type { ContractOperation } from "./contract-operations";

/**
 * A field of a request's body, query string or headers that names something by identifier:
 * a UUID, or a field called `id` or ending in `Id` or `Ids`. Its key reads like
 * "POST /workspace/tasks body.assessmentId"; a field inside a list reads like
 * "content.blocks[].id".
 */
export type RequestIdentifier = { key: string; operation: ContractOperation; field: string };

type Schema = { _zod: { def: Def } };
type Def = {
  type: string;
  format?: string;
  shape?: Record<string, Schema>;
  innerType?: Schema;
  element?: Schema;
  options?: Schema[];
  left?: Schema;
  right?: Schema;
  in?: Schema;
  getter?: () => Schema;
};

const IDENTIFIER_NAME = /^(id|ids|[a-z][A-Za-z0-9]*Ids?)$/;
// Wrappers that leave the value's own shape unchanged.
const WRAPPERS = new Set(["optional", "nullable", "default", "prefault", "nonoptional", "readonly", "catch"]);

/** The schema under its optional, nullable and default wrappers. */
function unwrap(schema: Schema): Schema {
  let current = schema;
  while (WRAPPERS.has(current._zod.def.type)) current = current._zod.def.innerType!;
  return current;
}

/** True for a UUID, or a list of them. */
function holdsUuid(schema: Schema): boolean {
  const def = unwrap(schema)._zod.def;
  if (def.type === "array") return holdsUuid(def.element!);
  if (def.type === "union") return def.options!.some(holdsUuid);
  return def.type === "string" && def.format === "uuid";
}

/** Every field path in `schema` whose name or value marks an identifier. */
function identifierFields(schema: Schema, prefix = "", seen = new Set<Schema>()): string[] {
  const inner = unwrap(schema);
  if (seen.has(inner)) return [];
  seen.add(inner);
  const def = inner._zod.def;
  switch (def.type) {
    case "object":
      return Object.entries(def.shape!).flatMap(([name, child]) => {
        const path = prefix ? `${prefix}.${name}` : name;
        return [
          ...(IDENTIFIER_NAME.test(name) || holdsUuid(child) ? [path] : []),
          ...identifierFields(child, path, seen),
        ];
      });
    case "array":
      return identifierFields(def.element!, `${prefix}[]`, seen);
    case "union":
      return [...new Set(def.options!.flatMap((option) => identifierFields(option, prefix, seen)))];
    case "intersection":
      return [...identifierFields(def.left!, prefix, seen), ...identifierFields(def.right!, prefix, seen)];
    case "pipe":
      return identifierFields(def.in!, prefix, seen);
    case "lazy":
      return identifierFields(def.getter!(), prefix, seen);
    default:
      return [];
  }
}

/**
 * The identifiers each operation takes outside its path, read from the generated Zod schemas the
 * API validates every request with (`<OperationId>Body`, `<OperationId>QueryParams` and
 * `<OperationId>Header`), so a field the API accepts cannot be missed here.
 */
export function requestIdentifiers(operations: ContractOperation[]): RequestIdentifier[] {
  const schemas = api as unknown as Record<string, Schema | undefined>;
  return operations.flatMap((operation) => {
    if (!operation.operationId) throw Error(`${operation.key} has no operationId`);
    const name = operation.operationId[0]!.toUpperCase() + operation.operationId.slice(1);
    return (
      [
        ["body", schemas[`${name}Body`]],
        ["query", schemas[`${name}QueryParams`]],
        ["header", schemas[`${name}Header`]],
      ] as const
    ).flatMap(([where, schema]) =>
      schema
        ? identifierFields(schema).map((field) => ({
            key: `${operation.key} ${where}.${field}`,
            operation,
            field: `${where}.${field}`,
          }))
        : [],
    );
  });
}
