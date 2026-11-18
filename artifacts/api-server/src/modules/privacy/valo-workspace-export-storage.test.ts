import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, truncate, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, PassThrough } from "node:stream";
import { createHash } from "node:crypto";
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
test(
  "actual native storage adapter bounds bytes and couples late SDK streams to cancellation",
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "valo-canonical-storage-")),
      source = join(directory, "source.json"),
      bytes = Buffer.from('{"synthetic":true}');
    await writeFile(source, bytes);
    t.after(() => rm(directory, { recursive: true, force: true }));
    let calls: string[] = [],
      download: () => Readable,
      exists: () => Promise<{ ok: true; value: boolean }>,
      upload: (stream: Readable) => Promise<void>;
    const reset = () => {
      calls = [];
      download = () => Readable.from([bytes]);
      exists = async () => ({ ok: true, value: false });
      upload = async (read) => {
        for await (const _ of read) {
        }
      };
    };
    reset();
    t.mock.module(new URL("../../lib/valo-private-storage.ts", import.meta.url).href, {
      namedExports: {
        privateWorkspaceObject: () => ({
          name: "synthetic",
          client: {
            exists: () => {
              calls.push("exists");
              return exists();
            },
            downloadAsStream: () => {
              calls.push("get");
              return download();
            },
            uploadFromStream: (_name: string, read: Readable) => {
              calls.push("put");
              return upload(read);
            },
          },
        }),
        deletePrivateFile: async () => {
          throw Error("NO_NATIVE_DELETE");
        },
      },
    });
    const {
      workspaceFileDigest,
      workspaceExportStorage: storage,
      WORKSPACE_EXPORT_MAX_BYTES,
    } = await import("./valo-workspace-export-storage");
    await t.test("real files accept the exact byte cap and reject the next byte", async () => {
      const path = join(directory, "sparse");
      await writeFile(path, "");
      await truncate(path, WORKSPACE_EXPORT_MAX_BYTES);
      assert.equal((await workspaceFileDigest(path)).size, WORKSPACE_EXPORT_MAX_BYTES);
      await truncate(path, WORKSPACE_EXPORT_MAX_BYTES + 1);
      await assert.rejects(workspaceFileDigest(path), /SIZE_LIMIT/);
      await rm(path);
    });
    await t.test("pre-abort and an abort after existence reply never start upload", async () => {
      reset();
      const c = new AbortController();
      c.abort(Error("STOP"));
      await assert.rejects(storage.put("key", source, c.signal), /STOP/);
      assert.equal(calls.length, 0);
      const next = new AbortController(),
        entered = deferred<void>(),
        reply = deferred<{ ok: true; value: boolean }>();
      exists = () => {
        entered.resolve();
        return reply.promise;
      };
      const work = storage.put("key", source, next.signal);
      await entered.promise;
      reply.resolve({ ok: true, value: false });
      next.abort(Error("LATE_STOP"));
      await assert.rejects(work, /LATE_STOP/);
      assert.ok(!calls.includes("put"));
    });
    await t.test(
      "existing keys cannot overwrite; completed files have actual checksum and private read bytes",
      async () => {
        reset();
        exists = async () => ({ ok: true, value: true });
        await assert.rejects(storage.put("key", source, new AbortController().signal), /FRESH/);
        assert.ok(!calls.includes("put"));
        reset();
        await storage.put("key", source, new AbortController().signal);
        assert.ok(calls.includes("put"));
        const path = join(directory, "read.json");
        await storage.get("key", path, new AbortController().signal);
        assert.deepEqual(await readFile(path), bytes);
        assert.equal(
          (await workspaceFileDigest(path)).checksum,
          createHash("sha256").update(bytes).digest("hex"),
        );
      },
    );
    await t.test("late source behind SDK wrapper is destroyed after abort", async () => {
      reset();
      const c = new AbortController(),
        wrapper = new PassThrough(),
        started = deferred<void>();
      let produced = 0;
      const upstream = new Readable({
        read() {
          produced++;
          this.push(bytes);
        },
      });
      download = () => {
        started.resolve();
        return wrapper;
      };
      const work = storage.get("key", join(directory, "cancelled"), c.signal);
      await started.promise;
      c.abort();
      await assert.rejects(work, { name: "AbortError" });
      upstream.pipe(wrapper);
      await new Promise<void>((r) => setImmediate(r));
      assert.equal(upstream.destroyed, true);
      assert.equal(produced, 0);
    });
    await t.test("an over-cap download stops the actual upstream before unlimited bytes", async () => {
      reset();
      let produced = 0;
      const wrapper = new PassThrough(),
        upstream = new Readable({
          read() {
            produced++;
            this.push(Buffer.alloc(1024 * 1024));
          },
        });
      download = () => {
        queueMicrotask(() => upstream.pipe(wrapper));
        return wrapper;
      };
      await assert.rejects(
        storage.get("key", join(directory, "oversize"), new AbortController().signal),
        /SIZE_LIMIT/,
      );
      assert.equal(upstream.destroyed, true);
      assert.ok(produced < 140);
    });
  },
);
