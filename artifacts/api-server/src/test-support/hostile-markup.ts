/**
 * Markup that runs script wherever a page draws it as HTML instead of as text, for the tests of stored
 * and reflected markup (docs/architecture/hostile-input.md, parts 2 and 3). Each payload that runs sets
 * `window.__vh`, so a test can tell whether any of it ran however it got in. Every payload is
 * synthetic, and none reaches beyond the page it is drawn in.
 */

/** Short enough for a title or a name: an element with an error handler, an attribute broken out of,
 * a script, and SQL text. */
export const SHORT_MARKUP = `<img src=x id=valo-hostile onerror="window.__vh=1">"><svg onload="window.__vh=2"><script>window.__vh=3</script>'; DROP TABLE valo_tasks;--`;

/** For a message or a paragraph: the short payload, then a framed script, a script address, a handler
 * that fires on its own, template text and HTML entities. */
export const LONG_MARKUP = `${SHORT_MARKUP} <iframe srcdoc="<script>parent.__vh=4</script>"></iframe><a href="javascript:window.__vh=5">open</a><details open ontoggle="window.__vh=6"><summary>more</summary></details>{{constructor.constructor('window.__vh=7')()}} \${window.__vh=8} &lt;b&gt;bold&lt;/b&gt;`;

/** A part of every payload that a page drawing it as text shows exactly. */
export const MARK = "<img src=x id=valo-hostile";

/** What a payload leaves in a page that drew it as HTML. The app sets no inline handler, script or
 * framed document of its own. */
export const INJECTED =
  '#valo-hostile, [onerror], [onload], [ontoggle], iframe[srcdoc], object, embed, a[href^="javascript" i], script:not([src])';

/** Run in the page: whether any payload ran, what it left, and every text the page shows, its form
 * fields' values among them. */
export const PROBE = `(() => ({
  ran: window.__vh ?? null,
  injected: [...document.querySelectorAll(${JSON.stringify(INJECTED)})].map((e) => e.outerHTML.slice(0, 160)),
  text: document.body.innerText + "\\n" + [...document.querySelectorAll("input, textarea")].map((e) => e.value).join("\\n"),
}))()`;

export type Probe = { ran: unknown; injected: string[]; text: string };
