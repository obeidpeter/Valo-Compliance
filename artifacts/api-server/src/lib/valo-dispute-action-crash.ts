import { controlDisputeAction } from "./valo-dispute-actions";
import { makeDisputeTransport } from "./valo-dispute-provider";
import { setting } from "../platform/settings";
if (
  setting("NODE_ENV") !== "development" ||
  setting("REPLIT_DEPLOYMENT") ||
  setting("VALO_RUN_DISPUTE_TESTS") !== "synthetic-development-only" ||
  setting("PAYSTACK_SECRET_KEY") ||
  !process.send
)
  throw Error("CONTROLLED_CHILD_REQUIRED");
const input = JSON.parse(setting("VALO_DISPUTE_CRASH")!);
const provider = makeDisputeTransport(
  async (_path, _body, method) => {
    if (!method || method === "GET") return input.canonical;
    process.send!({ stage: "controlled-provider-applied" });
    await new Promise<void>(() => {});
  },
  async () => {
    throw Error("UNEXPECTED_UPLOAD");
  },
  () => true,
);
await controlDisputeAction(
  input.actor,
  input.id,
  "execute",
  { expectedVersion: 1, acknowledgement: true },
  provider,
);
throw Error("CRASH_BARRIER_NOT_REACHED");
