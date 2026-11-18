import assert from "node:assert/strict";
import { test } from "node:test";
import { TicketInputCategory } from "@workspace/api-client-react";
import { enquiryProblems, needsSharingConsent } from "./enquiry";

test("the enquiry form asks for sharing consent before a service enquiry and not for product support", () => {
  const draft = {
    scope: "Synthetic enquiry about filing dates",
    email: "synthetic@example.test",
    consent: false,
  };
  const categories = Object.values(TicketInputCategory);
  assert.equal(categories.length, 8, "every topic in the API contract is checked");
  for (const category of categories) {
    assert.equal(needsSharingConsent(category), category !== "support", category);
    assert.equal(Boolean(enquiryProblems({ ...draft, category }).consent), category !== "support", category);
    assert.equal(enquiryProblems({ ...draft, category, consent: true }).consent, "", category);
  }
  assert.match(enquiryProblems({ ...draft, category: "tax" }).consent, /service enquiry/);
  assert.equal(
    enquiryProblems({ ...draft, category: "tax", consent: true, scope: "short" }).scope,
    "Describe what you need in at least 10 characters.",
  );
  assert.equal(
    enquiryProblems({ ...draft, category: "tax", consent: true, email: "not-an-email" }).email,
    "Enter an email we can reply to.",
  );
  assert.deepEqual(enquiryProblems({ ...draft, category: "tax", consent: true }), {
    scope: "",
    email: "",
    consent: "",
  });
});
