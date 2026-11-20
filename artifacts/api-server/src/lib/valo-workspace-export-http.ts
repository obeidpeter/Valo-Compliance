import { Router, type Request } from "express";
import { getAuth, clerkClient } from "@clerk/express";
import { z } from "zod";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { CreateWorkspaceDataExportBody } from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { assertWorkspaceDownloadSession } from "./valo-download-session";
import {
  createWorkspaceExport,
  listWorkspaceExports,
  getWorkspaceExport,
  cancelWorkspaceExport,
  retryWorkspaceExport,
  withPreparedWorkspaceExport,
  workspaceExportStorage,
  type WorkspaceExportStorage,
} from "../modules/privacy";
import { type WorkspaceActor } from "./valo-store";
import { ValoProblem } from "../platform/valo-problem";
import { assertApplicationRuntime } from "../platform/valo-runtime-activation";
const live = async (req: Request, actor: WorkspaceActor) =>
  assertWorkspaceDownloadSession(actor, getAuth(req), {
    session: (id) => clerkClient.sessions.getSession(id),
    user: (id) => clerkClient.users.getUser(id),
  });
/** Dependencies are server-owned. HTTP input never supplies authorization or storage. */
export function makeWorkspaceExportRouter(
  verify: typeof live = live,
  storage: WorkspaceExportStorage = workspaceExportStorage,
) {
  const router = Router();
  router.use("/workspace/data-exports", (_req, res, next) => {
    assertApplicationRuntime();
    res.set({
      "Cache-Control": "private, no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  router.get("/workspace/data-exports", async (req, res) => {
    res.json(
      await listWorkspaceExports(res.locals.valoActor, z.string().uuid().optional().parse(req.query.cursor)),
    );
  });
  router.get("/workspace/data-exports/:id", async (req, res) => {
    res.json(await getWorkspaceExport(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
  });
  router.post("/workspace/data-exports", sameOriginMutation, async (req, res) => {
    const input = CreateWorkspaceDataExportBody.strict().parse(req.body);
    await verify(req, res.locals.valoActor);
    res.status(201).json(await createWorkspaceExport(res.locals.valoActor, input.requestKey));
  });
  router.post("/workspace/data-exports/:id/cancel", sameOriginMutation, async (req, res) => {
    await verify(req, res.locals.valoActor);
    const input = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    res.json(
      await cancelWorkspaceExport(
        res.locals.valoActor,
        z.string().uuid().parse(req.params.id),
        input.expectedVersion,
      ),
    );
  });
  router.post("/workspace/data-exports/:id/retry", sameOriginMutation, async (req, res) => {
    await verify(req, res.locals.valoActor);
    const input = z.object({ expectedVersion: z.number().int().positive() }).strict().parse(req.body);
    res.json(
      await retryWorkspaceExport(
        res.locals.valoActor,
        z.string().uuid().parse(req.params.id),
        input.expectedVersion,
      ),
    );
  });
  router.get("/workspace/data-exports/:id/download", async (req, res) => {
    const actor = { ...res.locals.valoActor },
      id = z.string().uuid().parse(req.params.id),
      controller = new AbortController();
    const stop = () => controller.abort();
    req.once("aborted", stop);
    res.once("close", stop);
    if (req.aborted || res.destroyed) stop();
    try {
      await withPreparedWorkspaceExport(
        actor,
        id,
        controller.signal,
        () => verify(req, actor),
        async (path, proof, releaseSignal) => {
          let start = 0,
            end = proof.size - 1,
            partial = false;
          const range = req.headers.range;
          if (range && (!req.headers["if-range"] || req.headers["if-range"] === `"${proof.checksum}"`)) {
            const match = /^bytes=(\d+)-(\d*)$/.exec(range);
            if (!match) throw new ValoProblem(416, "Only a single explicit byte range is supported.");
            start = Number(match[1]);
            end = match[2] ? Number(match[2]) : end;
            if (
              !Number.isSafeInteger(start) ||
              !Number.isSafeInteger(end) ||
              start < 0 ||
              end < start ||
              start >= proof.size ||
              end >= proof.size
            )
              throw new ValoProblem(416, "The requested range is outside this complete artifact.");
            partial = true;
          }
          releaseSignal.throwIfAborted();
          res.set({
            "Content-Disposition": 'attachment; filename="valo-workspace-data.json"',
            "Content-Type": partial ? "application/octet-stream" : "application/json; charset=utf-8",
            "Content-Length": String(end - start + 1),
            ETag: `"${proof.checksum}"`,
            "Accept-Ranges": "bytes",
          });
          if (partial) res.status(206).set("Content-Range", `bytes ${start}-${end}/${proof.size}`);
          await pipeline(createReadStream(path, { start, end }), res, { signal: releaseSignal });
        },
        storage,
      );
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      req.off("aborted", stop);
      res.off("close", stop);
    }
  });
  return router;
}
