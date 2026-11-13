import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@workspace/valo-core";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const directory = resolve(root, "docs/valo/evidence/platform");
const records = readdirSync(directory).filter(path => path.endsWith(".md")).sort().map(path => {
  const bytes = readFileSync(resolve(directory, path));
  const content = bytes.toString("utf8");
  const url = content.match(/^Source: (https:\/\/[^\n]+)$/m)?.[1];
  const retrievedAt = content.match(/^Retrieved: ([^\n]+)$/m)?.[1];
  if (!url || !retrievedAt || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new Error(`Incomplete source metadata: ${path}`);
  }
  return {
    id: `PLATFORM-${path.replace(/\.md$/, "")}`,
    path: `docs/valo/evidence/platform/${path}`,
    url, retrievedAt, sha256: sha256(bytes), bytes: bytes.length,
    representation: "Extracted markdown with retrieval header",
    issuingBody: "Replit", jurisdiction: "Platform documentation",
    legalContentEvidence: false, approvedForLegalPublication: false,
    limitations: "Documents platform options, not measured runtime compatibility. No Nigerian regulatory claim mapping.",
  };
});
process.stdout.write(JSON.stringify({
  purpose: "Platform compatibility evidence; not an approved Nigerian legal evidence bundle",
  records,
  nigerianRegulatorySourcesApproved: 0,
}, null, 2) + "\n");
