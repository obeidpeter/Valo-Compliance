/**
 * Keeps keyboard focus clear of the bars that stay on screen (WCAG 2.2, Focus Not Obscured). The
 * page's scroll padding reserves room for the sticky header, the phone's bottom bar and a screen's
 * held actions (`index.css`). A browser uses that room only when it has to scroll to show what was
 * focused. An element already on the screen, partly under one of those bars, keeps its place, and
 * its edge stays hidden. So when focus lands on such an element, the page scrolls it into the room
 * the padding reserves, as the browser would have.
 */
let watching = false;

/** How far the page must scroll to bring a box clear of the reserved bands, or 0. */
export function clearance(
  box: { top: number; bottom: number },
  view: { height: number; paddingTop: number; paddingBottom: number },
) {
  const top = view.paddingTop,
    bottom = view.height - view.paddingBottom;
  // Too tall to fit between the bands: where the browser put it stands.
  if (box.bottom - box.top > bottom - top) return 0;
  if (box.bottom > bottom) return box.bottom - bottom;
  if (box.top < top) return box.top - top;
  return 0;
}

export function keepFocusClearOfBars() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  document.addEventListener("focusin", (event) => {
    const element = event.target;
    if (!(element instanceof HTMLElement) || element === document.body) return;
    // What sits in a bar, a dialog or a menu that stays put is already where it belongs.
    for (let each: HTMLElement | null = element; each; each = each.parentElement)
      if (["fixed", "sticky"].includes(getComputedStyle(each).position)) return;
    const page = getComputedStyle(document.documentElement);
    const by = clearance(element.getBoundingClientRect(), {
      height: window.innerHeight,
      paddingTop: Number.parseFloat(page.scrollPaddingTop) || 0,
      paddingBottom: Number.parseFloat(page.scrollPaddingBottom) || 0,
    });
    // The page's own scrolling, smooth unless motion is reduced.
    if (by) window.scrollBy({ top: by });
  });
}
