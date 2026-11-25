import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList } from "node:net";
import { allSourceLeads } from "@workspace/valo-core";
import { guidanceOfficialHosts } from "./official-hosts";
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_INSTRUMENT_BYTES = 32 * 1024 * 1024;
/** Larger ingestion is confined to explicitly identified authoritative instruments. */
export const sourceBodyLimit = (id: string) =>
  ["S02", "SV-010", "NIPC-BFA-2022", "NCC-COPYRIGHT"].includes(id) ? MAX_INSTRUMENT_BYTES : MAX_SOURCE_BYTES;
export class SourceFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}
const denied = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  denied.addSubnet(address, prefix, "ipv4");
export function assertPublicAddress(address: string) {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(address) || denied.check(address, "ipv4"))
    throw new SourceFailure("SOURCE_NON_PUBLIC_ADDRESS");
}
export function referenceFor(id: string) {
  const lead = allSourceLeads.find((s) => s.id === id);
  if (!lead) throw new SourceFailure("SOURCE_NOT_ALLOWLISTED");
  return lead;
}
export function assertSourceUrl(original: string, target: string) {
  if (!allSourceLeads.some((s) => s.url === original)) throw new SourceFailure("SOURCE_NOT_ALLOWLISTED");
  const start = new URL(original),
    next = new URL(target);
  if (
    next.protocol !== "https:" ||
    next.username ||
    next.password ||
    next.port ||
    next.hostname !== start.hostname
  )
    throw new SourceFailure("SOURCE_REDIRECT_NOT_ALLOWLISTED");
  return next;
}
async function publicAddress(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const values = await Promise.race([
      lookup(hostname, { family: 4, all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SourceFailure("SOURCE_DNS_TIMEOUT")), 5000);
      }),
    ]);
    if (!values.length) throw new SourceFailure("SOURCE_DNS_EMPTY");
    for (const value of values) assertPublicAddress(value.address);
    return values[0]!.address;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
async function request(url: URL, maximumBytes: number) {
  const address = await publicAddress(url.hostname);
  return new Promise<{ status: number; mime: string; location: string | undefined; bytes: Buffer }>(
    (resolve, reject) => {
      const req = https.request(
        url,
        {
          family: 4,
          agent: false,
          // Pin this connection to the checked IPv4 address, retaining normal TLS/SNI verification.
          lookup: (_host, _options, callback) => callback(null, address, 4),
          signal: AbortSignal.timeout(maximumBytes > MAX_SOURCE_BYTES ? 60000 : 15000),
          headers: {
            "user-agent": "Valo-development-source-check/1.0",
            accept: "text/html,application/pdf,text/plain;q=0.9",
            "accept-encoding": "identity",
          },
        },
        (res) => {
          const status = res.statusCode ?? 0,
            mime = String(res.headers["content-type"] ?? "")
              .split(";")[0]!
              .toLowerCase();
          if (status >= 300 && status < 400) {
            res.destroy();
            resolve({ status, mime, location: res.headers.location, bytes: Buffer.alloc(0) });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > maximumBytes) {
              res.destroy(new SourceFailure("SOURCE_TOO_LARGE"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("error", reject);
          res.on("end", () => resolve({ status, mime, location: undefined, bytes: Buffer.concat(chunks) }));
        },
      );
      req.on("error", reject);
      req.end();
    },
  );
}
export async function fetchOfficialSource(id: string) {
  const lead = referenceFor(id);
  let target: string = lead.url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const url = assertSourceUrl(lead.url, target);
    const response = await request(url, sourceBodyLimit(id));
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new SourceFailure("SOURCE_REDIRECT_MISSING");
      target = new URL(response.location, url).href;
      assertSourceUrl(lead.url, target);
      continue;
    }
    return { ...response, finalUrl: url.href, fetchedAt: new Date() };
  }
  throw new SourceFailure("SOURCE_REDIRECT_LIMIT");
}
/**
 * A public page that is not an official source, fetched with the same limits: https, a public
 * address, the same host across redirects and the page size cap. The caller passes its own fixed
 * list and the address must be on it. Nothing a request or a fetched page names is ever fetched.
 */
export async function fetchListedPage(
  address: string,
  listed: readonly string[],
  /** The transport; tests replace it so that nothing is sent. */
  send: typeof request = request,
) {
  if (!listed.includes(address)) throw new SourceFailure("SOURCE_NOT_ALLOWLISTED");
  const start = new URL(address);
  const allowed = (url: URL) =>
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    url.hostname === start.hostname;
  if (!allowed(start)) throw new SourceFailure("SOURCE_NOT_ALLOWLISTED");
  let target = start;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await send(target, MAX_SOURCE_BYTES);
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) throw new SourceFailure("SOURCE_REDIRECT_MISSING");
      const next = new URL(response.location, target);
      if (!allowed(next)) throw new SourceFailure("SOURCE_REDIRECT_NOT_ALLOWLISTED");
      target = next;
      continue;
    }
    return { ...response, finalUrl: target.href, fetchedAt: new Date() };
  }
  throw new SourceFailure("SOURCE_REDIRECT_LIMIT");
}

/** The transport a listed page or a registered source is fetched through; tests replace it so that
 * nothing is sent. */
export type SourceTransport = NonNullable<Parameters<typeof fetchListedPage>[2]>;

/**
 * An address a Content editor gives the source register (docs/architecture/source-register.md, slice 2):
 * https, with no user name, password or port, on a host the approved guidance policy lists. Returns the
 * address as the URL parser writes it.
 */
export function assertOfficialAddress(address: string) {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new SourceFailure("SOURCE_ADDRESS_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port)
    throw new SourceFailure("SOURCE_ADDRESS_INVALID");
  if (!(guidanceOfficialHosts as readonly string[]).includes(url.hostname))
    throw new SourceFailure("SOURCE_HOST_NOT_LISTED");
  return url;
}

/**
 * A source a Content editor added to the register, fetched with every check a lead in code gets: its
 * address on a host the policy lists, checked again here, a public address, the same host across at most
 * three redirects, and the page size cap. Nothing a request or a fetched page names is fetched.
 */
export async function fetchRegisteredSource(address: string, send?: SourceTransport) {
  const start = assertOfficialAddress(address).href;
  return fetchListedPage(start, [start], send);
}
