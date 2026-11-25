import test from "node:test";
import assert from "node:assert/strict";
import { allSourceLeads } from "@workspace/valo-core";
import {
  assertOfficialAddress,
  fetchRegisteredSource,
  MAX_SOURCE_BYTES,
  SourceFailure,
} from "./source-fetch";
import { sourceReference } from "./source-reference";
import type { SourceReader } from "./valo-source-state";

// docs/architecture/source-register.md, slice 2 (ADM-003): a source a Content editor adds is read only at
// an https address on a host the approved guidance policy lists, with every check a lead in code gets.
// Nothing here is sent anywhere: the transport is a stand-in that records what it was asked for.
type Answer = { status: number; mime: string; location: string | undefined; bytes: Buffer };
const answer = (over: Partial<Answer> = {}): Answer => ({
  status: 200,
  mime: "text/html",
  location: undefined,
  bytes: Buffer.from("<html><body>Synthetic official page</body></html>"),
  ...over,
});
const failure = (code: string) => (error: unknown) => error instanceof SourceFailure && error.code === code;

test("a registered source's address is https on a host the guidance policy lists, with no user name, password or port", () => {
  assert.equal(
    assertOfficialAddress("https://nafdac.gov.ng/synthetic-guideline").href,
    "https://nafdac.gov.ng/synthetic-guideline",
  );
  assert.equal(assertOfficialAddress("HTTPS://NDPC.GOV.NG/a?b=1").href, "https://ndpc.gov.ng/a?b=1");
  for (const [address, code] of [
    ["http://nafdac.gov.ng/synthetic", "SOURCE_ADDRESS_INVALID"],
    ["https://someone:secret@nafdac.gov.ng/synthetic", "SOURCE_ADDRESS_INVALID"],
    ["https://nafdac.gov.ng:8443/synthetic", "SOURCE_ADDRESS_INVALID"],
    ["not an address", "SOURCE_ADDRESS_INVALID"],
    ["https://example.invalid/synthetic", "SOURCE_HOST_NOT_LISTED"],
    ["https://nafdac.gov.ng.example.invalid/synthetic", "SOURCE_HOST_NOT_LISTED"],
    ["https://synthetic.nafdac.gov.ng/synthetic", "SOURCE_HOST_NOT_LISTED"],
    ["https://127.0.0.1/synthetic", "SOURCE_HOST_NOT_LISTED"],
  ] as const)
    assert.throws(() => assertOfficialAddress(address), failure(code), address);
});

test("a registered source is fetched only on a policy host, and a redirect stays on that host over https", async () => {
  const asked: string[] = [];
  const through = (answers: Answer[]) => async (url: URL, limit: number) => {
    assert.equal(limit, MAX_SOURCE_BYTES);
    asked.push(url.href);
    return answers.shift()!;
  };
  // An address off the policy's hosts is refused before anything is sent.
  await assert.rejects(
    fetchRegisteredSource("https://example.invalid/synthetic", through([answer()])),
    failure("SOURCE_HOST_NOT_LISTED"),
  );
  assert.deepEqual(asked, []);
  // A redirect on the same host is followed.
  const read = await fetchRegisteredSource(
    "https://nafdac.gov.ng/synthetic",
    through([answer({ status: 301, location: "/synthetic-moved" }), answer()]),
  );
  assert.equal(read.finalUrl, "https://nafdac.gov.ng/synthetic-moved");
  assert.deepEqual(asked, ["https://nafdac.gov.ng/synthetic", "https://nafdac.gov.ng/synthetic-moved"]);
  // A redirect to another host, even another policy host, or to http, is refused.
  for (const location of [
    "https://ndpc.gov.ng/synthetic",
    "https://example.invalid/",
    "http://nafdac.gov.ng/x",
  ])
    await assert.rejects(
      fetchRegisteredSource(
        "https://nafdac.gov.ng/synthetic",
        through([answer({ status: 302, location }), answer()]),
      ),
      failure("SOURCE_REDIRECT_NOT_ALLOWLISTED"),
      location,
    );
});

test("a source id names a lead kept in the repository, or the register's latest version while it is active on a policy host", async () => {
  const reader = (rows: Record<string, unknown>[]) => {
    const calls: unknown[] = [];
    const read: SourceReader = {
      execute: (async (query: unknown) => {
        calls.push(query);
        return { rows };
      }) as SourceReader["execute"],
    };
    return { read, calls };
  };
  // A lead kept in the repository is read from code, without asking the database.
  const lead = allSourceLeads[3]!;
  const inCode = reader([]);
  assert.deepEqual(await sourceReference(inCode.read, lead.id), {
    id: lead.id,
    title: lead.title,
    url: lead.url,
    origin: "repository",
  });
  assert.equal(inCode.calls.length, 0);
  // A source staff added is read from its latest version.
  const added = reader([
    { title: "Synthetic guideline", url: "https://nafdac.gov.ng/synthetic", status: "active" },
  ]);
  assert.deepEqual(await sourceReference(added.read, "REG-001"), {
    id: "REG-001",
    title: "Synthetic guideline",
    url: "https://nafdac.gov.ng/synthetic",
    origin: "register",
  });
  assert.equal(added.calls.length, 1);
  // Retired, missing, or at an address off the policy's hosts (as a row put straight into the database
  // could be), it is not read.
  await assert.rejects(
    sourceReference(
      reader([{ title: "Synthetic", url: "https://nafdac.gov.ng/synthetic", status: "retired" }]).read,
      "REG-001",
    ),
    failure("SOURCE_RETIRED"),
  );
  await assert.rejects(sourceReference(reader([]).read, "REG-404"), failure("SOURCE_NOT_ALLOWLISTED"));
  await assert.rejects(
    sourceReference(
      reader([{ title: "Synthetic", url: "https://example.invalid/synthetic", status: "active" }]).read,
      "REG-002",
    ),
    failure("SOURCE_HOST_NOT_LISTED"),
  );
  // No lead kept in the repository takes the prefix the register gives the sources staff add.
  assert.ok(allSourceLeads.every((entry) => !entry.id.startsWith("REG-")));
});
