import { Router } from "express";
import {
  CreateDocumentExportHeader,
  CreateDocumentExportParams,
  ListDocumentExportsParams,
  ListDocumentExportsResponse,
  RetryDocumentExportParams,
  RetryDocumentExportBody,
  RetryDocumentExportResponse,
  DownloadDocumentExportParams,
} from "@workspace/api-zod";
import { verifiedWorkspace, sameOriginMutation } from "../middlewares/valo-identity";
import { requestExport, listExports, retryExport, downloadExport } from "../lib/valo-exports";
import { consumeQuota, quotaSubjectHash } from "../lib/valo-quota";
import { setting } from "../platform/settings";
const router = Router();
const paths = ["/v1/documents/:id/exports", "/v1/exports/:id/retry", "/v1/exports/:id/file"];
router.use(paths, sameOriginMutation, verifiedWorkspace);
router.use(paths, async (req, res, next) => {
  if (req.method === "POST") {
    const quota = await consumeQuota(
      "export-create",
      quotaSubjectHash(setting("SESSION_SECRET"), "user", res.locals.valoActor.identityId),
    );
    if (!quota.allowed) {
      res.setHeader("Retry-After", String(quota.retryAfter));
      res.status(429).json({ error: "Export request limit reached. Wait and retry; your document is safe." });
      return;
    }
  }
  next();
});
router.get("/v1/documents/:id/exports", async (req, res) => {
  const { id } = ListDocumentExportsParams.parse(req.params);
  res.json(ListDocumentExportsResponse.parse(await listExports(res.locals.valoActor, id)));
});
router.post("/v1/documents/:id/exports", async (req, res) => {
  const { id } = CreateDocumentExportParams.parse(req.params);
  const headers = CreateDocumentExportHeader.parse({ "Idempotency-Key": req.get("Idempotency-Key") });
  res.status(202).json(await requestExport(res.locals.valoActor, id, headers["Idempotency-Key"], req.body));
});
router.post("/v1/exports/:id/retry", async (req, res) => {
  const { id } = RetryDocumentExportParams.parse(req.params);
  RetryDocumentExportBody.strict().parse(req.body);
  res.status(202).json(RetryDocumentExportResponse.parse(await retryExport(res.locals.valoActor, id)));
});
router.get("/v1/exports/:id/file", async (req, res) => {
  const { id } = DownloadDocumentExportParams.parse(req.params);
  const file = await downloadExport(res.locals.valoActor, id);
  res.set({
    "Content-Type": file.mime,
    "Content-Disposition": `attachment; filename="${file.filename}"`,
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization",
    "X-Content-Type-Options": "nosniff",
    "Content-Length": String(file.bytes.length),
  });
  res.send(file.bytes);
});
export default router;
