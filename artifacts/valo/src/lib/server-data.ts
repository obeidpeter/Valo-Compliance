/**
 * A query's options for data the server already read for the page (decision 0011): the browser shows
 * it at once and treats it as fresh for 15 seconds, the interval the public pages read again on.
 * Without it, the browser reads the data itself.
 */
export function fromServer<T>(initial: T | undefined) {
  return initial === undefined ? {} : { initialData: initial, staleTime: 15_000 };
}
