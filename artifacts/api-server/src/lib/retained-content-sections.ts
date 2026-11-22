import { sha256 } from "@workspace/valo-core";

export const practicalDraftPath = "docs/content-candidates/practical-guide-candidates.md";
export const industryDraftPath = "docs/content-candidates/industry-content-candidates.md";
export const originalProvenanceNote = {
  path: "docs/content-candidates/chatgpt-content-provenance-rights.md",
  sha256: "57080e5d1a4105c3b3545b8e94f65662eb8e1d5ce08f2b88154fcfc345aca616",
};

export type NamedContentSection = {
  identity: string;
  sourcePath: string;
  heading: string;
  baselineSectionSha256: string;
  category: "practical-guide" | "industry-landing" | "industry-deeper-pack";
};

/** Use the exact retained bytes from this heading up to the next heading of depth 1–3. */
export function retainedContentSections(path: string, body: string) {
  const headers = [...body.matchAll(/^#{1,3} .+$/gm)];
  return headers.flatMap((match, index) => {
    const heading = match[0].replace(/^#+ /, "");
    const isGuide = path === practicalDraftPath && /^## GUIDE-C\d{2} — /.test(match[0]);
    if (!isGuide && !(path === industryDraftPath && match[0].startsWith("### "))) return [];
    const sourceText = body.slice(match.index, headers[index + 1]?.index ?? body.length);
    const section: NamedContentSection = {
      identity: `${path}#${heading}`,
      sourcePath: path,
      heading,
      baselineSectionSha256: sha256(sourceText),
      category: isGuide
        ? "practical-guide"
        : heading.endsWith(" — deeper pack")
          ? "industry-deeper-pack"
          : "industry-landing",
    };
    return [{ section, sourceText }];
  });
}
