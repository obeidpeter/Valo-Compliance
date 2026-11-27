/**
 * Reads a Word file the way Word does before it shows one, and says what would make Word refuse it
 * (EDT-006, docs/architecture/editor.md, slice 3): a part that is not well-formed XML; a part, or a
 * relationship's target, missing from the package or from its content types; a main document of
 * another type; a table cell with no paragraph; a table with no grid. It is not Word itself, which
 * cannot run here: opening a file in Word stays a manual check.
 *
 * Each problem names a part of the package, never its text, so it is safe to record.
 */
import { unzipSync } from "fflate";

const MAIN_DOCUMENT = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml";
const OFFICE_DOCUMENT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";

/** An element of a part, with its attributes and the elements inside it. */
type XmlElement = { name: string; attributes: Map<string, string>; children: XmlElement[] };

const NAME = String.raw`[A-Za-z_][\w.\-]*(?::[A-Za-z_][\w.\-]*)?`;
const START_TAG = new RegExp(
  String.raw`<(${NAME})((?:\s+${NAME}\s*=\s*(?:"[^<"]*"|'[^<']*'))*)\s*(/?)>`,
  "y",
);
const END_TAG = new RegExp(String.raw`</(${NAME})\s*>`, "y");
const ATTRIBUTE = new RegExp(String.raw`(${NAME})\s*=\s*(?:"([^<"]*)"|'([^<']*)')`, "g");
/** An ampersand that starts none of XML's entities or character references. */
const BARE_AMPERSAND = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);)/;
/** A character XML 1.0 does not allow: a control character other than tab, line feed and carriage
 * return, a lone surrogate, or U+FFFE and U+FFFF. */
const NOT_XML = /[^\t\n\r -퟿-�\u{10000}-\u{10FFFF}]/u;

const decodeEntities = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\dA-Fa-f]+);/g, (_, entity: string) =>
    entity.startsWith("#x")
      ? String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
      : entity.startsWith("#")
        ? String.fromCodePoint(Number(entity.slice(1)))
        : ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[entity]!,
  );

/** A part's root element, or why the part is not well-formed XML. */
export function parseXml(text: string): XmlElement | string {
  if (NOT_XML.test(text)) return "it holds a character XML does not allow";
  const top: XmlElement = { name: "", attributes: new Map(), children: [] };
  const open = [top];
  let at = 0;
  while (at < text.length) {
    const next = text.indexOf("<", at);
    const between = next < 0 ? text.slice(at) : text.slice(at, next);
    if (BARE_AMPERSAND.test(between)) return "it has an ampersand that starts no entity";
    if (open.length === 1 && between.trim()) return "it has text outside its root element";
    if (next < 0) break;
    if (text.startsWith("<?", next)) {
      const end = text.indexOf("?>", next + 2);
      if (end < 0) return "a processing instruction is not closed";
      at = end + 2;
    } else if (text.startsWith("<!--", next)) {
      const end = text.indexOf("-->", next + 4);
      if (end < 0) return "a comment is not closed";
      at = end + 3;
    } else if (text.startsWith("<![CDATA[", next)) {
      const end = text.indexOf("]]>", next + 9);
      if (open.length === 1) return "it has character data outside its root element";
      if (end < 0) return "character data is not closed";
      at = end + 3;
    } else if (text.startsWith("<!", next)) {
      return "it declares a document type";
    } else if (text.startsWith("</", next)) {
      END_TAG.lastIndex = next;
      const end = END_TAG.exec(text);
      if (!end) return "an end tag is not well formed";
      const current = open.pop()!;
      if (open.length === 0 || current.name !== end[1])
        return `the end tag ${end[1]} does not close the element open there`;
      at = END_TAG.lastIndex;
    } else {
      START_TAG.lastIndex = next;
      const start = START_TAG.exec(text);
      if (!start) return "a start tag is not well formed";
      const attributes = new Map<string, string>();
      for (const [, name, double, single] of start[2]!.matchAll(ATTRIBUTE)) {
        const value = double ?? single ?? "";
        if (attributes.has(name!)) return `an element has the attribute ${name} twice`;
        if (BARE_AMPERSAND.test(value)) return "an attribute has an ampersand that starts no entity";
        attributes.set(name!, decodeEntities(value));
      }
      if (open.length === 1 && top.children.length) return "it has more than one root element";
      const element: XmlElement = { name: start[1]!, attributes, children: [] };
      open.at(-1)!.children.push(element);
      if (!start[3]) open.push(element);
      at = START_TAG.lastIndex;
    }
  }
  if (open.length > 1) return `the element ${open.at(-1)!.name} is not closed`;
  return top.children[0] ?? "it has no root element";
}

function* elements(root: XmlElement): Generator<XmlElement> {
  yield root;
  for (const child of root.children) yield* elements(child);
}
/** A relationship target as a part name: relative to the source part's folder, or from the root. */
function resolvePart(source: string, target: string) {
  const base = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const segment of target.replace(/^\//, "").split("/"))
    if (segment === "..") base.pop();
    else if (segment && segment !== ".") base.push(segment);
  return base.join("/");
}

/** What would make Word refuse the file, each naming the part it is in; none when Word would open it. */
export function wordFileProblems(bytes: Uint8Array): string[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return ["the file is not a zip package"];
  }
  const parts = new Map(Object.entries(entries).filter(([name]) => !name.endsWith("/")));
  const problems: string[] = [];
  const xml = new Map<string, XmlElement>();
  for (const [name, content] of parts) {
    if (!/\.(xml|rels)$/i.test(name)) continue;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(content);
    } catch {
      problems.push(`${name} is not UTF-8 text`);
      continue;
    }
    const parsed = parseXml(text.replace(/^﻿/, ""));
    if (typeof parsed === "string") problems.push(`${name} is not well-formed XML: ${parsed}`);
    else xml.set(name, parsed);
  }
  const types = xml.get("[Content_Types].xml");
  if (!parts.has("[Content_Types].xml")) problems.push("the package has no [Content_Types].xml");
  const defaults = new Map<string, string>(),
    overrides = new Map<string, string>();
  for (const element of types ? elements(types) : []) {
    const contentType = element.attributes.get("ContentType") ?? "";
    if (element.name === "Default")
      defaults.set((element.attributes.get("Extension") ?? "").toLowerCase(), contentType);
    if (element.name === "Override")
      overrides.set((element.attributes.get("PartName") ?? "").replace(/^\//, ""), contentType);
  }
  const typeOf = (part: string) => overrides.get(part) ?? defaults.get(part.split(".").pop()!.toLowerCase());
  for (const part of parts.keys())
    if (part !== "[Content_Types].xml" && typeOf(part) === undefined)
      problems.push(`${part} has no content type`);
  for (const part of overrides.keys())
    if (!parts.has(part)) problems.push(`the content types name ${part}, which the package does not hold`);
  let main: string | undefined;
  for (const [name, root] of xml) {
    const found = /^(.*?)_rels\/([^/]*)\.rels$/.exec(name);
    if (!found) continue;
    const source = found[1]! + found[2]!;
    for (const relationship of elements(root)) {
      if (relationship.name !== "Relationship" || relationship.attributes.get("TargetMode") === "External")
        continue;
      const target = resolvePart(source, relationship.attributes.get("Target") ?? "");
      if (!parts.has(target)) problems.push(`${name} points to ${target}, which the package does not hold`);
      if (source === "" && relationship.attributes.get("Type") === OFFICE_DOCUMENT) main = target;
    }
  }
  if (!parts.has("_rels/.rels")) problems.push("the package has no _rels/.rels");
  else if (!main) problems.push("the package names no main document");
  else if (parts.has(main) && typeOf(main) !== MAIN_DOCUMENT)
    problems.push(`${main} is not a Word document's main part`);
  for (const [name, root] of xml)
    for (const element of elements(root)) {
      if (element.name === "w:tc" && !element.children.some((child) => child.name === "w:p"))
        problems.push(`a table cell in ${name} has no paragraph`);
      if (element.name === "w:tbl" && !element.children.some((child) => child.name === "w:tblGrid"))
        problems.push(`a table in ${name} has no grid`);
    }
  return problems;
}

/** Refuses a Word file that Word would refuse: the export worker gives no such file to the customer. */
export function assertWordFileOpens(bytes: Uint8Array) {
  if (wordFileProblems(bytes).length) throw new Error("WORD_FILE_CHECK_FAILED");
}
