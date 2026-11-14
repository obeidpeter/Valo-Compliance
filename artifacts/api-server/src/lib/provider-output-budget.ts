import {assertInputBudget,InputComplexityError} from "./request-complexity";
/** Tokens requested from a provider are not a validation budget. Apply this to
 * actual output before invoking any schema, including constrained collections. */
export function parseBoundedProviderJSON(text:string):unknown{
  if(Buffer.byteLength(text,"utf8")>128*1024)throw new InputComplexityError("Provider output exceeds the supported byte limit.");
  const value:unknown=JSON.parse(text);assertInputBudget(value);return value;
}
