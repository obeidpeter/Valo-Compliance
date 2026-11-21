/** Shared safe domain failure. This contract must not initialise database,
 * identity or provider clients merely to validate a request or signature. */
export class ValoProblem extends Error {
  constructor(
    public status: number,
    message: string,
    public currentRevision?: number,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
