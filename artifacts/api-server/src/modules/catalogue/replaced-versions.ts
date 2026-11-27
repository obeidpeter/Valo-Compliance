/**
 * When a reviewed template's version is replaced (docs/architecture/reviewed-route.md, part 1): once a
 * later version of the same template has been released, whether that later version is still published
 * or was withdrawn since. A version is withdrawn only after it was published, so either state means it
 * was released. A replaced version is never live again, as a superseded release in the staff library
 * never returns.
 */
export const releasedStates = ["published", "withdrawn"] as const;

const wasReleased = (status: string) => (releasedStates as readonly string[]).includes(status);

/** The latest released version of each template among these versions, by template. */
export function latestReleased<T extends { templateId: string; version: number; status: string }>(
  versions: readonly T[],
) {
  const latest = new Map<string, T>();
  for (const version of versions)
    if (wasReleased(version.status) && version.version > (latest.get(version.templateId)?.version ?? 0))
      latest.set(version.templateId, version);
  return latest;
}

/** Whether a version is replaced, given the latest released version of each template. */
export function isReplaced(
  version: { templateId: string; version: number },
  latest: ReadonlyMap<string, { version: number }>,
) {
  return (latest.get(version.templateId)?.version ?? 0) > version.version;
}

/** What a customer is told when asking for a replaced version's file, or to start a document from it. */
export const REPLACED_VERSION =
  "A newer version of this template was released. Get it from the template's page.";
