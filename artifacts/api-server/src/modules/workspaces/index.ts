/**
 * The workspaces module's public entry: the workspace access checks and write limits every
 * workspace's records go through, the audit trail they write, workspace resolution (the only place
 * an identity's membership becomes a workspace actor) and the workspace with its profile. Like the
 * other modules, it loads the database client only inside the functions that query it. Code outside
 * artifacts/api-server/src/modules/workspaces imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 */
export * from "./valo-workspaces";
