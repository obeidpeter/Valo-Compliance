// Lets the publisher connect as valo_publisher_login (lib/db/src/publisher-login.ts).
// Run with the application's DATABASE_URL and the login's new password in
// VALO_PUBLISHER_LOGIN_PASSWORD (from the environment's secret store). It enables the login
// with that password, sent only as a SCRAM-SHA-256 verifier so the password itself never
// reaches the server or its logs. With --print-url it prints the connection string to store
// as VALO_PUBLISHER_DATABASE_URL: the same database, as the login.
import { pathToFileURL } from "node:url";
import pg from "pg";
import { scramVerifier } from "./workspace-login.mjs";

export const PUBLISHER_LOGIN_ROLE = "valo_publisher_login";

/** The application's connection string with the login's name and password. */
export function publisherLoginUrl(databaseUrl, password) {
  const url = new URL(databaseUrl);
  url.username = PUBLISHER_LOGIN_ROLE;
  url.password = password;
  return url.toString();
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL,
    password = process.env.VALO_PUBLISHER_LOGIN_PASSWORD;
  if (!databaseUrl) throw Error("DATABASE_URL must be the application's connection string");
  // Printable ASCII needs no SASLprep, so the verifier matches what the server derives.
  if (!password || !/^[\x21-\x7e]{24,}$/.test(password))
    throw Error("VALO_PUBLISHER_LOGIN_PASSWORD must be at least 24 printable ASCII characters");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const { rows } = await client.query(
      "SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', $1::text, $2::text) AS sql",
      [PUBLISHER_LOGIN_ROLE, scramVerifier(password)],
    );
    await client.query(rows[0].sql);
  } finally {
    await client.end();
  }
  if (process.argv.includes("--print-url")) console.log(publisherLoginUrl(databaseUrl, password));
  else
    console.error(
      `${PUBLISHER_LOGIN_ROLE} can log in; store its connection string as VALO_PUBLISHER_DATABASE_URL.`,
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
