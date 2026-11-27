// Lets customer requests connect as valo_workspace_login (lib/db/src/workspace-scope.ts).
// Run with the application's DATABASE_URL and the login's new password in
// VALO_WORKSPACE_LOGIN_PASSWORD (from the environment's secret store). It enables the login
// with that password, sent only as a SCRAM-SHA-256 verifier so the password itself never
// reaches the server or its logs. With --print-url it prints the connection string to store
// as VALO_CUSTOMER_DATABASE_URL: the same database, as the login.
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const WORKSPACE_LOGIN_ROLE = "valo_workspace_login";

/** PostgreSQL's stored form of a SCRAM-SHA-256 password (RFC 5802, 4096 iterations). */
export function scramVerifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** The application's connection string with the login's name and password. */
export function workspaceLoginUrl(databaseUrl, password) {
  const url = new URL(databaseUrl);
  url.username = WORKSPACE_LOGIN_ROLE;
  url.password = password;
  return url.toString();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL,
    password = process.env.VALO_WORKSPACE_LOGIN_PASSWORD;
  if (!databaseUrl) throw Error("DATABASE_URL must be the application's connection string");
  // Printable ASCII needs no SASLprep, so the verifier matches what the server derives.
  if (!password || !/^[\x21-\x7e]{24,}$/.test(password))
    throw Error("VALO_WORKSPACE_LOGIN_PASSWORD must be at least 24 printable ASCII characters");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
      [WORKSPACE_LOGIN_ROLE, scramVerifier(password)],
    );
    await client.query(rows[0].sql);
  } finally {
    await client.end();
  }
  if (process.argv.includes("--print-url")) console.log(workspaceLoginUrl(databaseUrl, password));
  else
    console.error(
      `${WORKSPACE_LOGIN_ROLE} can log in; store its connection string as VALO_CUSTOMER_DATABASE_URL.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
