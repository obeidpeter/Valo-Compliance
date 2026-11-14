/** Form metadata is not a published master or legal applicability rule. */
export const GUIDED_TEMPLATE_IDS=[
  "TPL-01","TPL-02","TPL-03","TPL-04","TPL-05","TPL-08",
  "TPL-12","TPL-13","TPL-14","TPL-15","TPL-16","TPL-17",
] as const;
export type GuidedTemplateId=typeof GUIDED_TEMPLATE_IDS[number];
export type GuidedField={
  id:string;label:string;
  type:"text"|"long_text"|"date"|"integer"|"quantity"|"money_kobo"|"select"|"acknowledgement";
  required:boolean;
  help?:string;
  options?:{value:string;label:string}[];
  when?:{field:string;equals:string};
  /** Exact customer-body placeholders, never statutory citations. */
  tokens?:string[];
  positive?:boolean;
};
export type GuidedTable={
  id:string;label:string;columns:GuidedField[];minRows:number;maxRows:number;help?:string;
  when?:{field:string;equals:string};
};
export type GuidedSpec={
  schemaVersion:1;templateId:GuidedTemplateId;title:string;description:string;
  fields:GuidedField[];tables:GuidedTable[];
  sections:{id:string;label:string;fieldIds:string[];help?:string}[];
  notices:string[];
  dateOrder?:{before:string;after:string;message:string}[];
};
export type GuidedData={
  schemaVersion:1;templateId:GuidedTemplateId;
  values:Record<string,string>;
  tables:Record<string,Record<string,string>[]>;
};
