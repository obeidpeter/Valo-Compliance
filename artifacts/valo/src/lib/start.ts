/**
 * What a visitor asks for before they have an account, carried on the sign-up address so that they
 * start on it once signed in. It is a task's id from the landing page, or `ANY_DOCUMENT`. This
 * module imports nothing: the phone's bar on every public page uses it.
 */

/** What "Create a document" asks for: no task in particular, only the page where a document starts. */
export const ANY_DOCUMENT = "document";

/** What the anonymous requirements check asks for when continuing after sign-up or sign-in. */
export const CHECKER_START = "requirements";

/** The sign-up address that carries the choice. */
export const signUpFor = (start: string) => "/sign-up?start=" + encodeURIComponent(start);
