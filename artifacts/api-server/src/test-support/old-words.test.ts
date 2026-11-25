import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { oldWordsIn } from "./old-words";

/**
 * The browser word checks read the screens as they open. A sentence that shows only in another
 * state, such as an empty list, an opened form or a failure, is not on the screen then. This
 * reads the words where they are written: every piece of text in the web app's source that a
 * customer can be shown.
 */
const web = resolve(import.meta.dirname, "../../../valo");

/**
 * Screens and panels only staff or developers open. They keep the project's own words. A file that
 * holds anything a customer can be shown is not listed, even where staff panels share it.
 */
const NOT_FOR_CUSTOMERS = [
  "src/screens/staff.tsx",
  "src/screens/privacy-operations.tsx",
  "src/screens/finance-refunds.tsx",
  "src/screens/development.tsx",
  "src/components/staff-support-cases.tsx",
  "src/components/staff-support-case-detail.tsx",
  "src/components/content-escalations.tsx",
  "src/components/source-evidence.tsx",
  "src/components/source-safety-controls.tsx",
  "src/components/editorial-record.tsx",
  "src/components/prepared-candidates.tsx",
];

/**
 * Files outside the web app whose words the web app shows, each with what they are. Their text is
 * read as the web app's is.
 */
const SHOWN_FROM_ELSEWHERE = [
  // The requirements check's questions, which the check's page draws (RUL-001).
  "../../lib/valo-core/src/checker-questionnaire.ts",
];

/**
 * Text that holds an old word and is not shown as written, each with why. A line here is an
 * exception to the word list, so it says what it is.
 */
const NOT_SHOWN_AS_WRITTEN: { file: string; text: RegExp; why: string }[] = [
  {
    file: "src/lib/result-words.ts",
    text: /^Conditional source-governed guidance, not legal certification\./,
    why: "the rules engine's own notice, kept so that the screen can say it in the site's words instead",
  },
  {
    file: "src/lib/result-words.ts",
    text: /^Rule is not released$/,
    why: "the rules engine's own reason for holding a rule back, kept so that the screen can say it in the site's words instead",
  },
];

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(relative(web, path).replaceAll("\\", "/"));
    }
  };
  walk(join(web, directory));
  return found.sort();
}

/** Attributes whose value names something for the program, not for the reader. */
const NOT_READ =
  /^(className|class|href|to|id|htmlFor|type|name|role|rel|target|key|method|action|src|autoComplete|inputMode|variant|size|d|viewBox|fill|stroke|xmlns|data-.+|aria-(labelledby|describedby|controls|current|live))$/;

/** Words meant for a person: a phrase, or one word written as a label is. */
const forPeople = (text: string) => /[a-z]{3}/i.test(text) && (/\s/.test(text) || /^[A-Z][a-z]+$/.test(text));

/** Every piece of text in a file that a customer can be shown, with the line it is on. */
function shownText(file: string): { line: number; text: string }[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(join(web, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found: { line: number; text: string }[] = [];
  const add = (node: ts.Node, raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text) found.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, text });
  };
  const visit = (node: ts.Node) => {
    // Types and module names are for the compiler.
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node) && NOT_READ.test(node.name.getText())) return;
    if (ts.isJsxText(node)) add(node, node.text);
    else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      if (forPeople(node.text.trim())) add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("no text a customer can be shown, in any state of any screen, holds one of the project's own words that the word list replaced", () => {
  const files = [...sourceFiles("src"), ...sourceFiles("app"), ...SHOWN_FROM_ELSEWHERE].filter(
    (file) => !NOT_FOR_CUSTOMERS.includes(file),
  );
  assert.ok(files.length > 100, `the web app's source was read: ${files.length} files`);
  for (const file of NOT_FOR_CUSTOMERS)
    assert.doesNotThrow(() => readFileSync(join(web, file)), `${file} is still a file of the web app`);
  const pieces = files.flatMap((file) => shownText(file).map((piece) => ({ file, ...piece })));
  // The reader finds the text: sentences known to be on the screens are among what it read.
  for (const known of [
    "No documents yet",
    "Still needed",
    "Reminder emails are not being sent yet",
    "How is the business set up?",
  ])
    assert.ok(
      pieces.some((piece) => piece.text.includes(known)),
      `read: ${known}`,
    );
  const used = new Set<number>();
  const problems = pieces.flatMap(({ file, line, text }) => {
    const words = oldWordsIn(text);
    if (!words.length) return [];
    const exception = NOT_SHOWN_AS_WRITTEN.findIndex((each) => each.file === file && each.text.test(text));
    if (exception >= 0) {
      used.add(exception);
      return [];
    }
    return words.map((word) => `${file}:${line}: ${word}`);
  });
  assert.deepEqual(problems, []);
  // An exception that excuses nothing is out of date.
  assert.deepEqual(
    NOT_SHOWN_AS_WRITTEN.filter((_, index) => !used.has(index)).map((each) => `${each.file}: ${each.why}`),
    [],
  );
});
