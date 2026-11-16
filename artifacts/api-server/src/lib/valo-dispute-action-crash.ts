import { controlDisputeAction } from "./valo-dispute-actions";
import { makeDisputeTransport } from "./valo-dispute-provider";
if (
  process.env.NODE_ENV !== "development" ||
  process.env.REPLIT_DEPLOYMENT ||
  process.env.VALO_RUN_DISPUTE_TESTS !== "synthetic-development-only" ||
  process.env.PAYSTACK_SECRET_KEY ||
  !process.send
)
  throw Error("CONTROLLED_CHILD_REQUIRED");
const input = JSON.parse(process.env.VALO_DISPUTE_CRASH!);
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
