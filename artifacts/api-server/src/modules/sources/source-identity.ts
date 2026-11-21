/** Content identity is not amendment, effectivity, legal interpretation or publication approval. */
export function instrumentIdentity(id: string, text: string, metadataTitle: string | null) {
  const profile =
    id === "S02" || id === "NASS-NTAA-2025"
      ? {
          title: "Nigeria Tax Administration Act 2025",
          words: /nigeria\s+tax\s+administration\s+act/i,
          year: "2025",
        }
      : id === "SV-010"
        ? {
            title: "Companies and Allied Matters Act 2020",
            words: /companies\s+and\s+allied\s+matters\s+act/i,
            year: "2020",
          }
        : null;
  if (!profile) return null;
  const pages = text.split("\f");
  const matchingPages = pages.flatMap((page, index) => {
    const normalized = page.replace(/\s+/g, " ");
    return profile.words.test(normalized) && normalized.includes(profile.year) ? [index + 1] : [];
  });
  const metadataMatches =
    metadataTitle === null
      ? null
      : profile.words.test(metadataTitle.replace(/\s+/g, " ")) && metadataTitle.includes(profile.year);
  return {
    expectedTitle: profile.title,
    status: matchingPages.length ? "content_title_present_unreviewed" : "held_title_unconfirmed",
    matchingPages,
    metadataTitle,
    metadataMatches,
    metadataConflict: metadataMatches === false,
    warning:
      metadataMatches === false
        ? "Document metadata does not match the expected instrument. Inspect actual pages; do not trust the metadata title."
        : null,
  };
}
