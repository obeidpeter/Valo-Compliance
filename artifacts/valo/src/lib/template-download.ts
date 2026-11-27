export const templateDownloadSignInPath = (edition: string, slug: string) =>
  "/sign-in?start=" + encodeURIComponent("download-" + edition + "-" + slug);

/** Resume the selected edition on its own detail page after sign-in or sign-up. */
export function downloadStartPath(start: string | null | undefined) {
  const match = /^download-([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})-([^/\\?#]+)$/i.exec(
    start ?? "",
  );
  return match && match[2] !== "." && match[2] !== ".."
    ? "/library/" + encodeURIComponent(match[2]!) + "#download-" + match[1]!.toLowerCase()
    : undefined;
}
