import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { contractOperations, pathParameters } from "../test-support/contract-operations";

type Builder = (...values: string[]) => string;

/**
 * The browser client builds request paths from identifiers it is given, some of them read
 * from the page address. For every operation in the contract with a path parameter, the
 * generated function must keep each identifier inside its own path segment, its cache key
 * must name the operation, and the transport must refuse an identifier that would still
 * reach another endpoint.
 */
test("the generated web client keeps every identifier inside its own path segment", async (t) => {
  const original = globalThis.fetch;
  // Compile the real browser client in isolation; don't add browser source files or DOM
  // globals to the API server's TypeScript project.
  const dir = await mkdtemp(join(tmpdir(), "valo-client-paths-"));
  const source = fileURLToPath(new URL("../../../../lib/api-client-react/src/", import.meta.url));
  try {
    const bundle = await build({
      stdin: {
        contents: `export * from ${JSON.stringify(join(source, "generated/api.ts"))};
          export { customFetch, assertRequestPath } from ${JSON.stringify(join(source, "custom-fetch.ts"))};`,
        resolveDir: source,
      },
      bundle: true,
      write: false,
      format: "esm",
      platform: "node",
      logLevel: "silent",
    });
    const entry = join(dir, "client.mjs");
    await writeFile(entry, bundle.outputFiles![0]!.contents);
    const client = (await import(pathToFileURL(entry).href)) as Record<string, unknown> & {
      customFetch: (input: string) => Promise<unknown>;
      assertRequestPath: (url: string) => void;
    };
    const operations = contractOperations().filter((operation) => pathParameters(operation.path).length);
    assert.ok(operations.length > 40, "the contract has operations with path parameters");
    const pascal = (id: string) => id[0]!.toUpperCase() + id.slice(1);
    const builder = (operationId: string) => {
      const found = client[`get${pascal(operationId)}Url`];
      assert.equal(typeof found, "function", `${operationId} has a URL function`);
      return found as Builder;
    };
    // Each value would leave its segment if it were inserted as given.
    const hostile = (name: string, index: number) => `x/../${name}?step=${index}#part %2F\\.`;

    await t.test("each identifier is encoded once, into the segment its parameter names", () => {
      for (const operation of operations) {
        const names = pathParameters(operation.path),
          values = names.map(hostile),
          url = builder(operation.operationId!)(...values);
        const expected =
          "/api" +
          names.reduce(
            (path, name, i) => path.replace(`{${name}}`, encodeURIComponent(values[i]!)),
            operation.path,
          );
        assert.equal(url, expected, operation.key);
        assert.equal(
          new URL(url, "https://valo.invalid").pathname,
          expected,
          `${operation.key} after parsing`,
        );
      }
    });

    await t.test("cache keys name the operation and keep each identifier as its own element", () => {
      for (const operation of operations) {
        const key = client[`get${pascal(operation.operationId!)}QueryKey`];
        // Reads are cached queries; other methods are mutations and have no cache key.
        assert.equal(typeof key, operation.method === "GET" ? "function" : "undefined", operation.key);
        if (typeof key !== "function") continue;
        const values = pathParameters(operation.path).map(hostile),
          [name, ...elements] = (key as (...v: string[]) => unknown[])(...values);
        // orval fixes the order of the identifiers per operation, not always in path order.
        assert.equal(name, operation.operationId, operation.key);
        assert.deepEqual([...elements].sort(), [...values].sort(), operation.key);
      }
    });

    await t.test("an empty or dot identifier is refused before anything is sent", async () => {
      const sent: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        sent.push(String(input));
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }) as typeof fetch;
      for (const operation of operations) {
        const names = pathParameters(operation.path);
        for (let position = 0; position < names.length; position++)
          for (const unsafe of ["", ".", ".."]) {
            const values = names.map((_, i) => (i === position ? unsafe : "synthetic-id"));
            await assert.rejects(
              client.customFetch(builder(operation.operationId!)(...values)),
              /path parameter is empty or a dot segment/,
              `${operation.key} with ${JSON.stringify(unsafe)} as ${names[position]}`,
            );
          }
      }
      assert.deepEqual(sent, [], "nothing reached the network");
      const valid = builder("getReleasedResource")("synthetic slug/with?query");
      await client.customFetch(valid);
      assert.deepEqual(sent, ["/api/public/resources/synthetic%20slug%2Fwith%3Fquery"]);
    });

    await t.test("hand-written paths get the same check", () => {
      for (const unsafe of [
        "/api/workspace/documents/",
        "/api/workspace/documents//revisions",
        "/api/workspace/documents/%2e%2E",
        "/api/workspace/documents/.%2e/revisions",
        "/api/workspace/documents/.\n./revisions",
        "/api/workspace\\documents\\..\\x",
        "https://valo.invalid/api/workspace/documents/../x",
      ])
        assert.throws(() => client.assertRequestPath(unsafe), TypeError, JSON.stringify(unsafe));
      for (const safe of [
        "/api/workspace/documents/synthetic-id",
        "/api/workspace/documents/a%2F..%2Fb",
        "/api/workspace/documents?next=//x/../y",
        "/api/workspace/documents#/../",
        "https://valo.invalid/api/workspace/documents",
        "https://valo.invalid",
      ])
        assert.doesNotThrow(() => client.assertRequestPath(safe), JSON.stringify(safe));
    });
  } finally {
    globalThis.fetch = original;
    await rm(dir, { recursive: true, force: true });
  }
});
