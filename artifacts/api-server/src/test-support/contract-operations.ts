import { readFileSync } from "node:fs";

/** One HTTP operation declared in lib/api-spec/openapi.yaml, e.g. "PATCH /workspace/tasks/{id}". */
export type ContractOperation = { method: string; path: string; key: string };

const contractPath = new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url);
const METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/**
 * Reads the operations from the API contract without a YAML dependency. Under the
 * top-level `paths:` key the contract writes each path at two spaces, either with its
 * methods at four spaces or as one inline JSON object. Inline values that are not JSON
 * throw rather than being skipped. A unit test checks the result against the number of
 * operation IDs in the file.
 */
export function contractOperations(text = readFileSync(contractPath, "utf8")): ContractOperation[] {
  const operations: ContractOperation[] = [];
  let inPaths = false,
    path: string | null = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line.startsWith("paths:");
      path = null;
      continue;
    }
    if (!inPaths) continue;
    const inline = /^ {2}(\/\S*):\s*(\{.*\})\s*$/.exec(line);
    if (inline) {
      const methods = Object.keys(JSON.parse(inline[2]!) as Record<string, unknown>);
      for (const name of methods.filter((m) => METHODS.has(m))) {
        const method = name.toUpperCase();
        operations.push({ method, path: inline[1]!, key: `${method} ${inline[1]!}` });
      }
      path = null;
      continue;
    }
    const pathMatch = /^ {2}(\/\S*):\s*$/.exec(line);
    if (pathMatch) {
      path = pathMatch[1]!;
      continue;
    }
    const methodMatch = /^ {4}([a-z]+):\s*$/.exec(line);
    if (methodMatch && path && METHODS.has(methodMatch[1]!)) {
      const method = methodMatch[1]!.toUpperCase();
      operations.push({ method, path, key: `${method} ${path}` });
    }
  }
  return operations;
}

/** Path parameter names in declaration order, e.g. ["id", "previousId"]. */
export function pathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]!);
}
