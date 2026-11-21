import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Writable } from "node:stream";
import { test } from "node:test";
import express from "express";
import ts from "typescript";
import { oldWordsIn } from "../test-support/old-words";
import {
  DETAILS_NOT_ACCEPTED,
  onError,
  saysUnexpectedFailure,
  UNEXPECTED_FAILURE_CHANGING,
  UNEXPECTED_FAILURE_READING,
} from "./http-errors";
import { requestLogging } from "./http-logging";
import { createApplicationLogger } from "./logger";

/**
 * What the server says to a customer when it refuses a request. The web app shows these sentences
 * as they are sent, so they are in the site's words, like the screens. This reads them where they
 * are written, in the files reworded so far, and fails when one holds a word of the project's own.
 *
 * Decision 10 of docs/architecture/frontend-redesign.md: the sentences are reworded in batches. A
 * file joins `REWORDED` with its batch. The sentences about payments, privacy requests and the
 * drafting assistant wait for their own decisions (15, 14 and 13), and staff screens keep the
 * project's words.
 */
const source = resolve(import.meta.dirname, "..");
const REWORDED = [
  "platform/http-errors.ts",
  "middlewares/valo-quota.ts",
  "routes/valo-exports.ts",
  "routes/valo-requirements.ts",
  "modules/documents/valo-documents.ts",
  "modules/exports/valo-exports.ts",
  "modules/tasks/valo-tasks.ts",
  "modules/rules/valo-assessments.ts",
  "modules/workspaces/valo-workspaces.ts",
];

/** The project's own words for things the site names otherwise, beyond the screens' word list. */
const SYSTEM_WORDS =
  /\b(revisions?|exports?|regenerat\w*|recommendations?|questionnaire|membership|preferences|offset|eligible|source-linked|registry|idempotency\S*|business draft|free-form|guided (form|financial model)|retrieval|anonymous|reassess\w*)\b/i;

/**
 * Sentences that hold such a word and are left as they are on purpose, each with why. One that
 * excuses nothing fails the test.
 *
 * Two more kinds are left without holding one: "Workspace deletion is recorded" and its like, which
 * are about a privacy deletion and are reworded with the privacy sentences (decision 14); and the
 * answers to a request no page of the site sends, such as a body that is not JSON.
 */
const LEFT: { file: string; text: RegExp; why: string }[] = [
  {
    file: "modules/exports/valo-exports.ts",
    text: /^Exports remain disabled pending production storage/,
    why: "said only by a production build, which serves no customer yet; it is for whoever operates it",
  },
];

/** Every sentence a file can send: the text of each ValoProblem, and of each `error` in a reply. */
function sentences(file: string): { line: number; text: string }[] {
  const code = ts.createSourceFile(
    file,
    readFileSync(resolve(source, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: { line: number; text: string }[] = [];
  const words = (node: ts.Expression): string | null =>
    ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? node.head.text + node.templateSpans.map((span) => "N" + span.literal.text).join("")
        : null;
  const add = (node: ts.Expression) => {
    const text = words(node);
    if (text !== null)
      found.push({ line: code.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && node.expression.getText() === "ValoProblem" && node.arguments?.[1])
      add(node.arguments[1]);
    if (ts.isPropertyAssignment(node) && node.name.getText() === "error") add(node.initializer);
    if (ts.isVariableDeclaration(node) && node.initializer && /^[A-Z_]+$/.test(node.name.getText()))
      add(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(code);
  return found;
}

test("the sentences the server sends a customer, in the files reworded so far, hold none of the project's own words", () => {
  const all = REWORDED.flatMap((file) => sentences(file).map((sentence) => ({ file, ...sentence })));
  assert.ok(all.length >= 60, `the sentences were read: ${all.length}`);
  // The reader finds them: sentences known to be sent are among what it read.
  for (const known of [
    "This document was not found in your workspace.",
    "Some details were not accepted. Check them and try again.",
    "Too many changes in a short time. Try again in N seconds. Your saved work is unchanged. Keep this page open so that you do not lose what you have typed.",
  ])
    assert.ok(
      all.some((sentence) => sentence.text === known),
      `read: ${known}`,
    );
  const used = new Set<number>();
  const problems = all.flatMap(({ file, line, text }) => {
    const system = SYSTEM_WORDS.exec(text);
    const found = [...oldWordsIn(text), ...(system ? [`"${system[0]}" in "${text}"`] : [])];
    if (!found.length) return [];
    const left = LEFT.findIndex((each) => each.file === file && each.text.test(text));
    if (left >= 0) {
      used.add(left);
      return [];
    }
    return found.map((word) => `${file}:${line}: ${word}`);
  });
  assert.deepEqual(problems, []);
  assert.deepEqual(
    LEFT.filter((_, index) => !used.has(index)).map((each) => `${each.file}: ${each.why}`),
    [],
  );
});

test("a sentence the server sends ends as a sentence does, and never names a code of the system's", () => {
  for (const file of REWORDED)
    for (const { line, text } of sentences(file)) {
      assert.match(text, /[.?]$/, `${file}:${line}: ${text}`);
      assert.doesNotMatch(
        text,
        /\b[A-Z]{2,}_[A-Z_]+\b/,
        `${file}:${line}: a code is not a sentence: ${text}`,
      );
    }
});

test("a failure the server did not expect tells a request that only reads to try again, and any other to check what was saved first", async () => {
  const quiet = new Writable({
    write(_chunk, _encoding, next) {
      next();
    },
  });
  const host = express();
  host.use(requestLogging(createApplicationLogger(quiet)));
  host.all("/fails", (_req, _res, next) => next(new Error("synthetic failure")));
  host.use(onError);
  const server = host.listen(0, "127.0.0.1");
  await new Promise<void>((ready) => server.once("listening", ready));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const said = async (method: string) => {
      const reply = await fetch(`http://127.0.0.1:${address.port}/fails`, { method });
      assert.equal(reply.status, 503, method);
      const text = await reply.text();
      assert.ok(saysUnexpectedFailure(text), `${method}: ${text}`);
      return (JSON.parse(text) as { error: string }).error;
    };
    assert.equal(await said("GET"), UNEXPECTED_FAILURE_READING);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      assert.equal(await said(method), UNEXPECTED_FAILURE_CHANGING, method);
    // Reading promises nothing about what is saved, and a deliberate refusal is not mistaken for either.
    assert.doesNotMatch(UNEXPECTED_FAILURE_READING, /saved/);
    assert.match(UNEXPECTED_FAILURE_CHANGING, /may or may not have been saved/);
    assert.ok(!saysUnexpectedFailure(JSON.stringify({ error: DETAILS_NOT_ACCEPTED })));
  } finally {
    await new Promise<void>((done, failed) => server.close((error) => (error ? failed(error) : done())));
  }
});
