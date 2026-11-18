import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, valoEvents } from "@workspace/db";
import { resolveWorkspace, createDocument } from "./valo-store";
import { requestExport, getExport, downloadExport } from "./valo-exports";
import { syntheticDocument } from "./valo-test-fixtures";

/**
 * NFR-004: "Typical ≤10-page DOCX p95 ≤10s; PDF ≤30s under five parallel jobs", accepted with "job
 * telemetry, timeout/failure cases and content-format comparison; queue time included".
 *
 * Five exports of a document of at most ten pages are requested at once, four times for each format,
 * and the real export worker process renders them from its queue. Each job's time runs from its
 * request to its completion as the durable job events record them, so it includes the time the job
 * waited in the queue. One warm-up export of each format runs first, so the worker's start and the
 * browser's first launch are not counted. Files go to a temporary folder instead of private storage.
 * The AI draft target needs real provider calls and is not measured here. Synthetic records only.
 */
const ROUNDS = 4;
const PARALLEL = 5;
const LIMIT_MS = { docx: 10_000, pdf: 30_000 } as const;
const enabled =
  process.env.VALO_RUN_EXPORT_CRASH_TESTS === "synthetic-development-only" &&
  process.env.VALO_PORTABLE_WORKER_PRELOADED === "true";

/** Nearest-rank percentile. */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
};

/** A business draft of several pages: a long table of supplied lines and explanatory paragraphs. */
function typicalDocument(n: number) {
  const input = structuredClone(syntheticDocument);
  input.title = `Synthetic timing draft ${n}`;
  input.content.fields.issuerName = "Synthetic development business";
  input.content.fields.recipientName = "Synthetic customer";
  input.content.fields.documentNumber = `SYN-${n}`;
  input.content.blocks = [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `paragraph-${i + 1}`,
      type: "paragraph" as const,
      text: `Synthetic section ${i + 1}. ${"These user-supplied terms describe the agreed goods, the delivery arrangements and the supporting records the business keeps. ".repeat(6)}`,
      rows: [],
    })),
    {
      id: "lines",
      type: "table" as const,
      text: "",
      rows: Array.from({ length: 60 }, (_, i) => [
        `Synthetic line ${i + 1}`,
        "₦12,345.67",
        "A descriptive note supplied by the business for this line.",
      ]),
    },
  ];
  return input;
}

test(
  "five parallel DOCX and PDF exports finish within NFR-004's p95, queue time included",
  { skip: !enabled, timeout: 600_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    // A business may write 30 documents a minute, so each round of five uses a business of its own.
    const business = () => resolveWorkspace("synthetic-export-timing-" + randomUUID());
    const worker: ChildProcess = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--experimental-test-module-mocks",
        "--import",
        new URL("../test-support/private-file-process.mts", import.meta.url).href,
        "src/workers/export-worker.ts",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_ENV: "development" },
        detached: true,
        stdio: "ignore",
      },
    );
    const temp = await mkdtemp(join(tmpdir(), "valo-export-timing-"));
    const ready = async (actor: Awaited<ReturnType<typeof business>>, ids: string[]) => {
      const deadline = Date.now() + 120_000;
      for (;;) {
        const states = await Promise.all(ids.map(async (id) => (await getExport(actor, id)).job.status));
        assert.ok(!states.includes("failed"), `an export failed: ${states.join(", ")}`);
        if (states.every((state) => state === "ready")) return;
        assert.ok(Date.now() < deadline, `exports still ${states.join(", ")} after two minutes`);
        await sleep(100);
      }
    };
    try {
      const warmUpActor = await business();
      for (const format of ["docx", "pdf"] as const) {
        const actor = warmUpActor;
        const doc = await createDocument(actor, typicalDocument(-1));
        const warmUp = await requestExport(actor, doc.id, randomUUID(), {
          revisionId: doc.revisionId,
          format,
          acknowledgeDraft: true,
        });
        await ready(actor, [warmUp.id]);
      }
      const times: Record<"docx" | "pdf", { total: number; queued: number; rendering: number }[]> = {
        docx: [],
        pdf: [],
      };
      let pages = 0;
      for (const format of ["docx", "pdf"] as const)
        for (let round = 0; round < ROUNDS; round++) {
          const actor = await business();
          const documents = await Promise.all(
            Array.from({ length: PARALLEL }, (_, i) =>
              createDocument(actor, typicalDocument(round * PARALLEL + i)),
            ),
          );
          // Five requests at once; the worker takes them from its queue.
          const jobs = await Promise.all(
            documents.map((doc) =>
              requestExport(actor, doc.id, randomUUID(), {
                revisionId: doc.revisionId,
                format,
                acknowledgeDraft: true,
              }),
            ),
          );
          const ids = jobs.map((job) => job.id);
          await ready(actor, ids);
          const events = await db
            .select({ entityId: valoEvents.entityId, action: valoEvents.action, at: valoEvents.createdAt })
            .from(valoEvents)
            .where(and(eq(valoEvents.workspaceId, actor.workspaceId), inArray(valoEvents.entityId, ids)));
          for (const id of ids) {
            const at = (action: string) => {
              const found = events
                .filter((e) => e.entityId === id && e.action === action)
                .map((e) => e.at.getTime());
              assert.equal(found.length, 1, `${id} has one ${action} event`);
              return found[0]!;
            };
            const requested = at("export.requested"),
              running = at("export.running"),
              ready = at("export.ready");
            times[format].push({
              total: ready - requested,
              queued: running - requested,
              rendering: ready - running,
            });
          }
          if (format === "pdf" && round === 0) {
            // The document is typical: several pages, at most ten.
            const file = join(temp, "sample.pdf");
            await writeFile(file, (await downloadExport(actor, ids[0]!)).bytes);
            const info = (await promisify(execFile)("pdfinfo", [file])).stdout;
            pages = Number(/^Pages:\s+(\d+)$/m.exec(info)?.[1]);
            assert.ok(pages >= 2 && pages <= 10, `the sample PDF has ${pages} pages`);
          }
        }

      const rows = (["docx", "pdf"] as const).map((format) => {
        const of = times[format];
        return {
          format,
          count: of.length,
          p50: percentile(
            of.map((t) => t.total),
            50,
          ),
          p95: percentile(
            of.map((t) => t.total),
            95,
          ),
          queuedP95: percentile(
            of.map((t) => t.queued),
            95,
          ),
          renderingP95: percentile(
            of.map((t) => t.rendering),
            95,
          ),
        };
      });
      const summary = [
        `### NFR-004 export times: ${PARALLEL} parallel requests, ${ROUNDS} rounds per format, a ${pages}-page document`,
        "",
        "| Format | Jobs | p50 total ms | p95 total ms | p95 in queue ms | p95 rendering ms | Limit ms |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map(
          (r) =>
            `| ${r.format.toUpperCase()} | ${r.count} | ${r.p50} | ${r.p95} | ${r.queuedP95} | ${r.renderingP95} | ${LIMIT_MS[r.format]} |`,
        ),
        "",
        "Total runs from the request to completion, so it includes the time in the queue. Measured with one",
        "export worker and CI's synthetic database, after one warm-up export of each format. The AI draft",
        "target needs real provider calls and is not measured.",
        "",
      ].join("\n");
      process.stdout.write(summary + "\n");
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
      for (const row of rows) {
        assert.equal(row.count, ROUNDS * PARALLEL);
        assert.ok(
          row.p95 <= LIMIT_MS[row.format],
          `${row.format} p95 ${row.p95} ms exceeds ${LIMIT_MS[row.format]} ms`,
        );
      }
    } finally {
      if (worker.exitCode === null && !worker.signalCode) {
        const ended = new Promise<void>((resolve) => worker.once("exit", () => resolve()));
        process.kill(-worker.pid!, "SIGKILL");
        await ended;
      }
      await rm(temp, { recursive: true, force: true });
      await pool.end();
    }
  },
);
