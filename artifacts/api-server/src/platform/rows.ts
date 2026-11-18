/**
 * The one row a statement is certain to return: the row an INSERT or UPDATE ... RETURNING wrote,
 * the one row of an aggregate such as count(*) without GROUP BY, or a row read again by its key
 * after this code found it, in a table whose rows are never deleted. Anything that can match no
 * row, such as a lookup by an identifier from a request, is checked where it is read instead.
 *
 * TypeScript cannot know a statement returns a row, so this says so in one place, and fails
 * loudly if the certainty is ever wrong.
 */
export function singleRow<T>(rows: readonly T[]): T {
  const [row] = rows;
  if (rows.length !== 1 || row === undefined) throw new Error("DATABASE_EXPECTED_ONE_ROW");
  return row;
}
