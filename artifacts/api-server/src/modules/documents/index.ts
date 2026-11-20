/**
 * The documents module's public entry: a workspace's business drafts and their revisions, and the
 * codec that serialises a revision for its content hash and its exports. It depends on
 * modules/workspaces for the access checks, write limits and audit trail, never the other way. Like
 * the other modules, it loads the database client only inside the functions that query it. Code
 * outside artifacts/api-server/src/modules/documents imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 */
export * from "./valo-documents";
export * from "./valo-revision-codec";
