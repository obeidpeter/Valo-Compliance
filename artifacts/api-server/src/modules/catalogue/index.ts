/**
 * The catalogue module's public entry: the public catalogue, its search and discovery, the
 * released content customers may read or download, and saved templates. Code outside
 * artifacts/api-server/src/modules/catalogue imports only this file (repository rule `module-boundary`);
 * tests may import the module's files directly.
 */
export * from "./valo-catalogue";
export * from "./valo-public-discovery";
export * from "./valo-released-content";
export * from "./valo-saved-templates";
