export * from "./generated/api";
export * from "./generated/types";
// An operation with both path and query parameters gets a path-parameter schema in
// generated/api and a query-parameter type in generated/types with the same name.
// Export the schema, which the server validates with.
export { GetCustomerSupportCaseParams, GetStaffSupportCaseParams } from "./generated/api";
