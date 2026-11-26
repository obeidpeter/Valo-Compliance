import test from "node:test";
import assert from "node:assert/strict";

// The code is read without a database; the module only names one, which a unit run never opens.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const { failureCode } = await import("./review-preparation");

test("a preparation's request records the code it stopped with, a login's code even under a failed query, and nothing else (SEC-006)", () => {
  // A command's code, as the commands print it.
  assert.equal(failureCode(new Error("CANDIDATE_NOT_READY")), "CANDIDATE_NOT_READY");
  // Drafting's login, not given to the worker.
  assert.equal(
    failureCode(
      Object.assign(new Error("The drafting login is unavailable"), {
        code: "VALO_DRAFTER_LOGIN_UNAVAILABLE",
      }),
    ),
    "VALO_DRAFTER_LOGIN_UNAVAILABLE",
  );
  // Drafting's login, refused by the database: Drizzle reports the failed query with the login's
  // error as its cause.
  const refused = Object.assign(
    new Error("The drafting login is unavailable: the database refused its login"),
    {
      code: "VALO_DRAFTER_LOGIN_UNAVAILABLE",
    },
  );
  assert.equal(
    failureCode(new Error("Failed query: select session_user as login", { cause: refused })),
    "VALO_DRAFTER_LOGIN_UNAVAILABLE",
  );
  // Anything else is not repeated: a database's own code, or words.
  assert.equal(
    failureCode(Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" })),
    "PREPARATION_FAILED",
  );
  assert.equal(failureCode(new Error("A sentence that may hold private words")), "PREPARATION_FAILED");
  assert.equal(failureCode("not an error"), "PREPARATION_FAILED");
});
