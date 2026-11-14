import {z} from "zod";

/** Canonical test-dispute validation must not initialize database or provider clients. */
const id=z.union([z.string().regex(/^\d{1,40}$/),z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String);
export const verifiedDispute=z.object({id,domain:z.literal("test"),status:z.enum(["awaiting-merchant-feedback","awaiting-bank-feedback","pending","resolved","archived"]),
  resolution:z.string().max(100).nullable(),refund_amount:z.number().int().nonnegative().max(2147483647).nullable(),
  category:z.string().max(100).nullable().optional(),updatedAt:z.string().datetime().optional(),
  evidence:z.unknown().optional(),
  currency:z.literal("NGN").nullable(),transaction:z.object({id,domain:z.literal("test"),reference:z.string().max(150),
    amount:z.number().int().positive().max(2147483647),currency:z.literal("NGN")})});
