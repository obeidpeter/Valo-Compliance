import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy } from "./src/lib/content-security-policy";

export function middleware(request: NextRequest) {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = btoa(String.fromCharCode(...bytes));
  const policy = contentSecurityPolicy(nonce),
    headers = new Headers(request.headers);
  // Overwrite both values: client-supplied nonces/policies are never authority.
  headers.set("x-valo-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  if (policy.includes("frame-ancestors 'none'")) response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Browsers ignore HSTS on plain HTTP, so this is safe in local development.
  response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}
export const config = { matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon\\.svg|logo\\.svg).*)"] };
