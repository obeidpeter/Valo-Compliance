import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  unique,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { valoOrders } from "./valo-commerce";
const time = (name: string) => timestamp(name, { withTimezone: true });
export const valoPaymentConcerns = pgTable(
  "valo_payment_concerns",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    requestKey: uuid("request_key").notNull(),
    inputHash: text("input_hash").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    latestReply: text("latest_reply"),
    version: integer("version").notNull().default(1),
    createdAt: time("created_at").notNull().defaultNow(),
    updatedAt: time("updated_at").notNull().defaultNow(),
  },
  (t) => [
    unique("valo_concern_request_once").on(t.workspaceId, t.requestKey),
    // Events and messages reference a concern with its workspace and order, so they
    // cannot attach to another order's concern.
    unique("valo_concern_exact_binding").on(t.workspaceId, t.orderId, t.id),
    foreignKey({
      name: "valo_concern_order_scope",
      columns: [t.workspaceId, t.orderId],
      foreignColumns: [valoOrders.workspaceId, valoOrders.id],
    }),
    check("valo_payment_concerns_input_hash_check", sql`length(${t.inputHash}) = 64`),
    check(
      "valo_payment_concerns_status_check",
      sql`${t.status} IN ('open', 'needs_information', 'responded', 'closed')`,
    ),
  ],
);

export const valoPaymentConcernEvents = pgTable(
  "valo_payment_concern_events",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    concernId: uuid("concern_id").notNull(),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    reason: text("reason").notNull(),
    customerVisible: boolean("customer_visible").notNull().default(true),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "valo_concern_event_exact_concern_fk",
      columns: [t.workspaceId, t.orderId, t.concernId],
      foreignColumns: [valoPaymentConcerns.workspaceId, valoPaymentConcerns.orderId, valoPaymentConcerns.id],
    }),
    check(
      "valo_payment_concern_events_actor_type_check",
      sql`${t.actorType} IN ('customer', 'finance', 'worker')`,
    ),
  ],
);
export const valoConcernMessages = pgTable(
  "valo_concern_messages",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => valoPaymentConcernEvents.id),
    workspaceId: uuid("workspace_id").notNull(),
    orderId: uuid("order_id").notNull(),
    concernId: uuid("concern_id").notNull(),
    body: text("body").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "valo_concern_message_exact_concern_fk",
      columns: [t.workspaceId, t.orderId, t.concernId],
      foreignColumns: [valoPaymentConcerns.workspaceId, valoPaymentConcerns.orderId, valoPaymentConcerns.id],
    }),
    check("valo_concern_messages_body_check", sql`length(${t.body}) BETWEEN 10 AND 2000`),
  ],
);
