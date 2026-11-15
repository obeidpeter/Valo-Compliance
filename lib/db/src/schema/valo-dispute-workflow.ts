import {pgTable,uuid,text,integer,timestamp,jsonb,boolean,uniqueIndex,index,foreignKey} from "drizzle-orm/pg-core";
import {valoOrders,valoPaymentDisputes} from "./valo-commerce";
const time=(name:string)=>timestamp(name,{withTimezone:true});
export const valoPaymentConcerns=pgTable("valo_payment_concerns",{
 id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),orderId:uuid("order_id").notNull(),
 requestKey:uuid("request_key").notNull(),inputHash:text("input_hash").notNull(),message:text("message").notNull(),
 status:text("status").notNull().default("open"),latestReply:text("latest_reply"),version:integer("version").notNull().default(1),
 createdAt:time("created_at").notNull().defaultNow(),updatedAt:time("updated_at").notNull().defaultNow(),
},t=>[uniqueIndex("valo_concern_request_once").on(t.workspaceId,t.requestKey),
 foreignKey({name:"valo_concern_order_scope",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
export const valoDisputeWorkflows=pgTable("valo_dispute_workflows",{
 id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),orderId:uuid("order_id").notNull(),
 disputeId:uuid("dispute_id").notNull().references(()=>valoPaymentDisputes.id),providerId:text("provider_id").notNull(),
 canonicalStatus:text("canonical_status").notNull(),providerResolution:text("provider_resolution"),providerAmountKobo:integer("provider_amount_kobo"),
 category:text("category"),held:boolean("held").notNull().default(false),version:integer("version").notNull().default(1),
 checkedAt:time("checked_at").notNull().defaultNow(),createdAt:time("created_at").notNull().defaultNow(),
},t=>[uniqueIndex("valo_dispute_workflow_provider_once").on(t.providerId),uniqueIndex("valo_dispute_workflow_scope").on(t.workspaceId,t.orderId,t.id),
 foreignKey({name:"valo_dispute_workflow_order_scope",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
export const valoDisputeIntents=pgTable("valo_dispute_intents",{
 id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),orderId:uuid("order_id").notNull(),workflowId:uuid("workflow_id").notNull(),
 requestKey:uuid("request_key").notNull(),operation:text("operation").notNull(),state:text("state").notNull().default("prepared"),
 inputHash:text("input_hash").notNull(),payload:jsonb("payload").$type<Record<string,unknown>>().notNull(),
 sourceReference:text("source_reference").notNull(),summary:text("summary").notNull(),
 facts:jsonb("facts").$type<{label:string;value:string}[]>().notNull(),authorisedBy:text("authorised_by").notNull(),
 leaseToken:uuid("lease_token"),leaseUntil:time("lease_until"),attempts:integer("attempts").notNull().default(0),
 providerFilename:text("provider_filename"),providerEvidenceId:text("provider_evidence_id"),failure:text("failure"),
 createdAt:time("created_at").notNull().defaultNow(),attemptedAt:time("attempted_at"),acknowledgedAt:time("acknowledged_at"),
},t=>[uniqueIndex("valo_dispute_intent_key_once").on(t.workflowId,t.requestKey),index("valo_dispute_intent_recovery_idx").on(t.state,t.leaseUntil),
 foreignKey({name:"valo_dispute_intent_workflow_scope",columns:[t.workspaceId,t.orderId,t.workflowId],foreignColumns:[valoDisputeWorkflows.workspaceId,valoDisputeWorkflows.orderId,valoDisputeWorkflows.id]})]);
export const valoDisputeAudit=pgTable("valo_dispute_audit",{
 id:uuid("id").primaryKey(),workspaceId:uuid("workspace_id").notNull(),orderId:uuid("order_id").notNull(),
 workflowId:uuid("workflow_id").references(()=>valoDisputeWorkflows.id),concernId:uuid("concern_id").references(()=>valoPaymentConcerns.id),
 intentId:uuid("intent_id").references(()=>valoDisputeIntents.id),actorType:text("actor_type").notNull(),actorId:text("actor_id").notNull(),
 action:text("action").notNull(),reason:text("reason").notNull(),customerVisible:boolean("customer_visible").notNull().default(false),
 createdAt:time("created_at").notNull().defaultNow(),
},t=>[foreignKey({name:"valo_dispute_audit_order_scope",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);

/** Message bodies are separately removable; financial event metadata remains immutable. */
export const valoConcernMessages=pgTable("valo_concern_messages",{
 id:uuid("id").primaryKey().references(()=>valoDisputeAudit.id),workspaceId:uuid("workspace_id").notNull(),orderId:uuid("order_id").notNull(),
 concernId:uuid("concern_id").notNull().references(()=>valoPaymentConcerns.id),body:text("body").notNull(),createdAt:time("created_at").notNull().defaultNow(),
},t=>[foreignKey({name:"valo_concern_message_order_scope",columns:[t.workspaceId,t.orderId],foreignColumns:[valoOrders.workspaceId,valoOrders.id]})]);
