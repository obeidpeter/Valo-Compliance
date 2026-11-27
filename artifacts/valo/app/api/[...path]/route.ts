/**
 * The web server serves no API: the API service answers /api in front of it. A request for /api that
 * reaches the web server anyway, when nothing routes it elsewhere, gets a JSON 404 instead of a page,
 * so a page's island that reads the API sees a failure, not HTML it cannot use.
 */
const notFound = () =>
  Response.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "private, no-store" } });

export const dynamic = "force-dynamic";
export const GET = notFound;
export const HEAD = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const OPTIONS = notFound;
