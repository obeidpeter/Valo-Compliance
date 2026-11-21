/**
 * One round of NFR-001's external synthetic checks against VALO_SYNTHETIC_CHECK_URL: each core
 * journey once, one JSON line per journey on stdout. An external scheduler runs it every minute from
 * outside the application host and keeps the lines with the incident log (docs/valo/availability.md).
 * It reads only public pages and sends no account, cookie or customer data. Until a reviewed launch,
 * production answers only the health check, so the other journeys fail there.
 */
import { checkJourneys } from "../lib/valo-availability";

const base = process.env.VALO_SYNTHETIC_CHECK_URL;
if (!base) throw Error("VALO_SYNTHETIC_CHECK_URL is required");
const url = new URL(base);
if (
  url.protocol !== "https:" &&
  !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
)
  throw Error("VALO_SYNTHETIC_CHECK_URL must be https, or http on this machine");
if (url.username || url.password || url.search || url.hash)
  throw Error("VALO_SYNTHETIC_CHECK_URL must be a plain origin");
for (const result of await checkJourneys(url.origin)) process.stdout.write(JSON.stringify(result) + "\n");
