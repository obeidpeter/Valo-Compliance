import { isIP } from "node:net";
import type { Express, Request } from "express";
import { environment } from "../platform/settings";

/** Trust exact infrastructure addresses/CIDRs only after observing the ingress
 * topology. Empty configuration trusts no forwarding headers. Hop counts and
 * broad named private ranges are unsafe when the backend has shorter paths. */
export function trustedProxyRanges(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const ranges = raw.split(",").map((x) => x.trim());
  if (ranges.length > 16) throw Error("INVALID_TRUSTED_PROXY_RANGES");
  for (const range of ranges) {
    const parts = range.split("/"),
      family = isIP(parts[0] ?? "");
    if (
      !family ||
      parts.length > 2 ||
      parts[0].includes("%") ||
      (parts.length === 2 &&
        (!/^\d+$/.test(parts[1]) || Number(parts[1]) < 1 || Number(parts[1]) > (family === 4 ? 32 : 128)))
    )
      throw Error("INVALID_TRUSTED_PROXY_RANGES");
  }
  return ranges;
}
export function configureProxyBoundary(app: Express, env: NodeJS.ProcessEnv = environment()) {
  const ranges = trustedProxyRanges(env.VALO_TRUSTED_PROXY_CIDRS);
  app.set("trust proxy", ranges.length ? ranges : false);
}
export function clientAddress(req: Pick<Request, "ip" | "socket">): string {
  // Express walks the chain from the socket, stopping at the first untrusted hop.
  // A malformed forwarded address falls back to the socket, never a quota key
  // chosen by a caller or arbitrary text sent to the identity provider.
  if (req.ip && isIP(req.ip)) return req.ip;
  const peer = req.socket.remoteAddress;
  return peer && isIP(peer) ? peer : "unknown-socket";
}
