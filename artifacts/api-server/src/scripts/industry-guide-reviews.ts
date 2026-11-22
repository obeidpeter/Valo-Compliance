import { randomUUID } from "node:crypto";
import { link, open, readFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { digest } from "@workspace/valo-core";
import { prepareIndustryReviewPacket } from "../modules/publication";

type Packet = Awaited<ReturnType<typeof prepareIndustryReviewPacket>>;

async function verifyFile(path: string, expected: Packet) {
  const text = await readFile(path, "utf8");
  let saved: unknown;
  try {
    saved = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) throw Error("INDUSTRY_PACKET_INVALID_JSON");
    throw error;
  }
  if (!isDeepStrictEqual(expected, saved)) throw Error("INDUSTRY_PACKET_DOES_NOT_MATCH_ORIGINALS");
}

async function saveFile(path: string, packet: Packet) {
  const temporary = join(dirname(path), `.valo-industry-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(packet, null, 2) + "\n");
    } finally {
      await handle.close();
    }
    try {
      // A completed file becomes visible atomically. A competing or earlier preparation keeps its file.
      await link(temporary, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      await verifyFile(path, packet);
    }
  } finally {
    await unlink(temporary);
  }
}

export async function runIndustryGuideReviews(args: string[]) {
  const [action, destination] = args;
  if (args.length !== 2 || !destination || (action !== "prepare" && action !== "verify"))
    throw Error("Expected prepare or verify and a private output file path");
  const packet = await prepareIndustryReviewPacket();
  const path = resolve(destination);
  if (action === "prepare") await saveFile(path, packet);
  else await verifyFile(path, packet);
  return {
    status: packet.status,
    introductions: packet.records.filter(({ candidate }) => candidate.draft.kind === "introduction").length,
    deeperPacks: packet.records.filter(({ candidate }) => candidate.draft.kind === "deeper-pack").length,
    reviewBriefs: packet.records.reduce((count, record) => count + record.reviewBriefs.length, 0),
    packetSha256: digest(packet),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  console.log(JSON.stringify(await runIndustryGuideReviews(process.argv.slice(2)), null, 2));
