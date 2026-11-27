import { createHash } from "node:crypto";
import {
  BACKUP_RETENTION,
  processingInventory,
  type LawfulBasis,
  type ProcessingActivity,
  type ProcessorName,
} from "./processing-inventory";

/**
 * The privacy notice, made from the processing inventory (PRV-001, PRO-002;
 * docs/architecture/processing-inventory.md, part 2). It says, activity by activity, what Valo
 * processes and why, and sets what the service needs apart from what a person may choose. Its version
 * is a checksum of every word it shows, so that a record can keep the version a person was shown.
 *
 * It is a draft until the privacy owner approves its exact words by that version. It is not legal
 * advice and not a privacy professional's review.
 */

/** Each lawful basis by its name, in plain words. */
export const BASIS_WORDS: Readonly<Record<LawfulBasis, string>> = {
  consent: "Your consent",
  contract: "Our contract with you",
  legal_obligation: "A legal obligation",
  vital_interests: "Protecting someone's vital interests",
  public_task: "A task in the public interest",
  legitimate_interests: "Valo's legitimate interests",
};

/** Each outside service that may receive personal data, and what it does, in plain words. */
export const SERVICE_WORDS: Readonly<Record<ProcessorName, string>> = {
  Replit: "Replit hosts Valo, its database and its files.",
  Clerk: "Clerk runs sign-in and keeps your sign-in account.",
  "Resend, through Replit Connectors":
    "Resend, through Replit, sends Valo's email. Only test mail is sent, to one test address.",
  Paystack: "Paystack takes payments. It runs in test mode only, so no real money moves.",
  "OpenAI, through Replit AI Integrations":
    "OpenAI, through Replit, suggests wording when you ask the drafting assistant. No request is sent to it yet: none is approved.",
  "Backblaze B2": "Backblaze B2 would keep Valo's encrypted backups. It is not set up.",
};

export type PrivacyNoticeEntry = {
  id: string;
  title: string;
  purpose: string;
  /** The proposed basis and why, in plain words. */
  basis: string;
  data: readonly string[];
  /** Whom the data is about, as a sentence. */
  subjects: string;
  /** Who at Valo reads it. */
  staff: string;
  /** The outside services it reaches, each in plain words. */
  services: readonly string[];
  retention: string;
  /** For something a person may choose: how they choose it. */
  choice: string | null;
};

export type PrivacyNoticeContent = {
  title: string;
  draft: string;
  testData: string;
  needed: { heading: string; intro: string; entries: readonly PrivacyNoticeEntry[] };
  optional: {
    heading: string;
    intro: string;
    entries: readonly PrivacyNoticeEntry[];
    marketing: { title: string; text: string };
  };
  services: { heading: string; intro: string; items: readonly string[]; unverified: string };
  backups: { heading: string; text: string };
  rights: {
    heading: string;
    items: readonly { text: string; link: { href: string; label: string } }[];
  };
};

/** The notice, with its version: the checksum of its content as JSON. */
export type PrivacyNotice = PrivacyNoticeContent & { version: string };

const NO_STAFF = "Staff do not read it as part of the service, unless you agree to share it with support.";

/** Words as a sentence: "Account holders and visitors." */
function sentence(words: readonly string[]): string {
  const listed =
    words.length > 1 ? `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}` : (words[0] ?? "");
  return `${listed.charAt(0).toUpperCase()}${listed.slice(1)}.`;
}

function entry(activity: ProcessingActivity): PrivacyNoticeEntry {
  return {
    id: activity.id,
    title: activity.title,
    purpose: activity.purpose,
    basis: `${BASIS_WORDS[activity.basis]}. ${activity.basisReason}`,
    data: activity.data,
    subjects: sentence(activity.subjects),
    staff: activity.staff ?? NO_STAFF,
    services: activity.services.map((service) => SERVICE_WORDS[service]),
    retention: activity.retention,
    choice: activity.consent,
  };
}

/** The notice made from an inventory: by default, Valo's own. */
export function buildPrivacyNotice(
  activities: readonly ProcessingActivity[] = processingInventory,
): PrivacyNotice {
  const services = [...new Set(activities.flatMap((activity) => activity.services))];
  const content: PrivacyNoticeContent = {
    title: "What Valo does with your data",
    draft:
      "This notice is a draft. Valo's privacy owner has not approved its words, and no privacy professional has reviewed it. It is not legal advice. It describes what this development build does.",
    testData:
      "This build is for development and testing. Please do not enter real customer details or confidential business information.",
    needed: {
      heading: "What the service needs",
      intro:
        "Valo does this to give you the service you use, and to keep it safe. None of it depends on a choice below.",
      entries: activities.filter((activity) => activity.basis !== "consent").map(entry),
    },
    optional: {
      heading: "What you can choose",
      intro:
        "Each of these is off until you turn it on, and you can turn it off again. Saying no, or turning one off, changes nothing else you can do.",
      entries: activities.filter((activity) => activity.basis === "consent").map(entry),
      marketing: {
        title: "Marketing messages",
        text: "Off unless you turn them on in your business profile. Valo sends no marketing messages yet. Leaving them off changes nothing else you can do.",
      },
    },
    services: {
      heading: "Outside services",
      intro: "These services receive data from Valo, only for the work named above:",
      items: services.map((service) => SERVICE_WORDS[service]),
      unverified:
        "Where each of them keeps data, how long it keeps it, and Valo's contracts with them have not been checked yet.",
    },
    backups: { heading: "Backups", text: BACKUP_RETENTION },
    rights: {
      heading: "Your data, your requests",
      items: [
        {
          text: "In your workspace you can download your workspace's data, correct your business profile, and ask for something to be corrected, for more of your data, or for your workspace to be deleted.",
          link: { href: "/workspace/privacy", label: "Privacy and data" },
        },
        {
          text: "If you cannot sign in, you can still ask for help.",
          link: { href: "/account-access", label: "Trouble signing in" },
        },
        {
          text: "Anyone can write to Valo, without an account.",
          link: { href: "/contact", label: "Contact us" },
        },
      ],
    },
  };
  return { ...content, version: privacyNoticeVersion(content) };
}

/** The checksum of every word a notice shows. */
export function privacyNoticeVersion(content: PrivacyNoticeContent): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex");
}

/**
 * The privacy owner's approval of the notice's exact words, by its version. Only the privacy owner
 * approves it: never set or change this without that owner's explicit, current approval of the
 * version it names. Until it names the notice's current version, the notice says it is a draft.
 */
export const privacyNoticeApproval: { version: string; approvedOn: string } | null = null;

/** Whether an approval is of this notice's exact words. */
export function privacyNoticeApproved(
  notice: PrivacyNotice,
  approval: { version: string } | null = privacyNoticeApproval,
): boolean {
  return approval !== null && approval.version === notice.version;
}

let current: PrivacyNotice | undefined;

/** Valo's privacy notice as it stands. */
export function privacyNotice(): PrivacyNotice {
  current ??= buildPrivacyNotice();
  return current;
}
