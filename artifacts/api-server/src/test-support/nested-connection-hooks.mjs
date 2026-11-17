// Module hook for nested-connection-preload.mjs: once the shared database module has
// defined db and pool, hand them to the guard installer the preload set up.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.endsWith("/lib/db/src/index.ts") || result.source == null) return result;
  const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
  return { ...result, source: `${source}\n;globalThis.__valoNestedConnectionGuard?.({ db, pool });\n` };
}
