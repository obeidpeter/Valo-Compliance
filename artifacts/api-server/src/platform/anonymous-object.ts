/** Where an object of the private store would be, were it public. */
export const STORAGE_ORIGIN = "https://storage.googleapis.com";

/**
 * The status the storage service answers an anonymous request for an object with: the proof that a
 * private object is not publicly addressable (SEC-002). A redirect is that answer, never followed, so
 * a probe cannot be sent on to another address and report what it finds there. The bucket and the
 * object's name never leave this function. The origin is the storage service's, and a test's own
 * server in a test.
 */
export async function anonymousObjectStatus(bucket: string, name: string, origin = STORAGE_ORIGIN) {
  const response = await fetch(
    `${origin}/${encodeURIComponent(bucket)}/${name.split("/").map(encodeURIComponent).join("/")}`,
    { redirect: "manual", signal: AbortSignal.timeout(10_000) },
  );
  await response.body?.cancel();
  return response.status;
}
