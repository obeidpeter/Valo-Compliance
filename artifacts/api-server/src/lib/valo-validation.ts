import { CreateDocumentBody, SaveBusinessProfileBody, SaveDocumentBody, CreateSupportTicketBody } from "@workspace/api-zod";
import { synchronizeFinancialBlocks } from "@workspace/valo-core/money";

export const nigerianStates = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi",
  "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara",
  "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara",
] as const;

export const profileInput = SaveBusinessProfileBody.strict().superRefine((input, ctx) => {
  if (!Number.isSafeInteger(input.expectedRevision)) ctx.addIssue({ code: "custom", message: "Expected revision must be an integer" });
  if (!["unknown", "unanswered", ...nigerianStates].includes(input.profile.state))
    ctx.addIssue({ code: "custom", path: ["profile", "state"], message: "Choose a Nigerian state, FCT, unknown or unanswered" });
  if (!input.profile.businessName.trim()) ctx.addIssue({ code: "custom", path: ["profile", "businessName"], message: "Business name is required" });
  if (input.profile.activities.some(a => !a.trim())) ctx.addIssue({ code: "custom", path: ["profile", "activities"], message: "Activity must not be blank" });
  if (input.profile.turnoverYear !== "unknown" && (+input.profile.turnoverYear < 1900 || +input.profile.turnoverYear > 2200))
    ctx.addIssue({ code: "custom", path: ["profile", "turnoverYear"], message: "Invalid reporting year" });
});

export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function contentValid(input: { content: { fields: { issueDate: string; dueDate: string }; blocks: {id: string}[];
  financialInput?:{kind:string} } }) {
  const { issueDate, dueDate } = input.content.fields;
  return (!issueDate || calendarDate(issueDate)) && (!dueDate || calendarDate(dueDate)) &&
    (!issueDate || !dueDate || input.content.financialInput?.kind==="payment_reminder" || dueDate >= issueDate) &&
    new Set(input.content.blocks.map(b => b.id)).size === input.content.blocks.length;
}
function financialsValid(input:{content:Parameters<typeof synchronizeFinancialBlocks>[0]}){
  try{return JSON.stringify(synchronizeFinancialBlocks(input.content).blocks)===JSON.stringify(input.content.blocks);}
  catch{return false;}
}
export const documentInput = CreateDocumentBody.strict()
  .refine(i => Boolean(i.title.trim()), "Title must not be blank")
  .refine(contentValid, "Invalid or inconsistent calendar dates, or duplicate section identifiers")
  .refine(financialsValid,"Financial rows must match the supplied structured amounts. Use the financial fields to recalculate.");
export const documentUpdate = SaveDocumentBody.strict()
  .refine(i => Number.isSafeInteger(i.expectedRevision), "Expected revision must be an integer")
  .refine(i => Boolean(i.title.trim()), "Title must not be blank")
  .refine(contentValid, "Invalid or inconsistent calendar dates, or duplicate section identifiers")
  .refine(financialsValid,"Financial rows must match the supplied structured amounts. Use the financial fields to recalculate.");
export const ticketInput = CreateSupportTicketBody.strict()
  .refine(i => i.category === "support" || i.sharingConsent, "Service enquiries require explicit contact-sharing consent");
