import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { processingInventory } from "@workspace/valo-core";
import {
  BASIS_WORDS,
  SERVICE_WORDS,
  buildPrivacyNotice,
  privacyNotice,
  privacyNoticeApproval,
  privacyNoticeApproved,
  type PrivacyNotice,
} from "@workspace/valo-core/privacy-notice";

// PRV-001 and PRO-002 (docs/architecture/processing-inventory.md, slice 2): the privacy notice is made
// from the processing inventory, sets what the service needs apart from what a person may choose, and
// carries a version that names its exact words.
const notice = privacyNotice();
const needed = processingInventory.filter((activity) => activity.basis !== "consent");
const optional = processingInventory.filter((activity) => activity.basis === "consent");
const { version, ...content } = notice;

test("the notice shows each activity of the processing inventory once, what the service needs apart from what a person may choose", () => {
  assert.ok(needed.length > 5 && optional.length > 0);
  assert.deepEqual(
    notice.needed.entries.map((entry) => entry.id),
    needed.map((activity) => activity.id),
  );
  assert.deepEqual(
    notice.optional.entries.map((entry) => entry.id),
    optional.map((activity) => activity.id),
  );
  for (const entry of [...notice.needed.entries, ...notice.optional.entries]) {
    const activity = processingInventory.find((each) => each.id === entry.id)!;
    assert.equal(entry.title, activity.title);
    assert.equal(entry.purpose, activity.purpose);
    assert.equal(entry.basis, `${BASIS_WORDS[activity.basis]}. ${activity.basisReason}`);
    assert.deepEqual(entry.data, activity.data);
    assert.equal(entry.retention, activity.retention);
    assert.deepEqual(
      entry.services,
      activity.services.map((service) => SERVICE_WORDS[service]),
    );
    if (activity.staff) assert.equal(entry.staff, activity.staff);
    assert.equal(entry.choice, activity.consent);
  }
  // Every outside service an activity reaches is named among the services, and no other.
  assert.deepEqual(
    [...notice.services.items].sort(),
    [...new Set(processingInventory.flatMap((activity) => activity.services))]
      .map((service) => SERVICE_WORDS[service])
      .sort(),
  );
  assert.equal(notice.backups.text.includes("35 days"), true);
});

test("what a person may choose is off until they turn it on, saying no changes nothing else, and marketing is a choice of its own", () => {
  assert.match(notice.optional.intro, /off until you turn it on/);
  assert.match(notice.optional.intro, /changes nothing else you can do/);
  for (const entry of notice.optional.entries) assert.ok(entry.choice, entry.id);
  // Nothing the service needs rests on a person's consent, or asks for a choice.
  for (const entry of notice.needed.entries) {
    assert.equal(entry.choice, null, entry.id);
    assert.ok(!entry.basis.startsWith(BASIS_WORDS.consent), entry.id);
  }
  assert.match(notice.needed.intro, /None of it depends on a choice below/);
  // Marketing consent is set apart from the terms the service needs, and off by default.
  assert.match(notice.optional.marketing.text, /^Off unless you turn them on in your business profile\./);
  assert.match(notice.optional.marketing.text, /Leaving them off changes nothing else you can do\./);
  for (const entry of notice.needed.entries) assert.doesNotMatch(entry.purpose, /marketing/i, entry.id);
});

test("the notice's version is the checksum of every word it shows, and changes when any of them does", () => {
  assert.match(version, /^[0-9a-f]{64}$/);
  assert.equal(version, createHash("sha256").update(JSON.stringify(content)).digest("hex"));
  assert.equal(buildPrivacyNotice().version, version);
  const changed = buildPrivacyNotice(
    processingInventory.map((activity) =>
      activity.id === "support" ? { ...activity, retention: `${activity.retention} ` } : activity,
    ),
  );
  assert.notEqual(changed.version, version);
});

test("the notice says it is a draft until the privacy owner's approval names its exact version", () => {
  assert.equal(privacyNoticeApproval, null, "no approval of the notice is recorded");
  assert.equal(privacyNoticeApproved(notice), false);
  assert.match(notice.draft, /^This notice is a draft\. Valo's privacy owner has not approved its words/);
  assert.match(notice.draft, /It is not legal advice\./);
  assert.equal(privacyNoticeApproved(notice, { version }), true);
  const other: PrivacyNotice = buildPrivacyNotice(processingInventory.slice(1));
  assert.equal(privacyNoticeApproved(other, { version }), false);
});
