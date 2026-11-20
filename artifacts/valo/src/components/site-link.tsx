import { createContext, createElement, useContext, type ComponentProps } from "react";
import { Link } from "wouter";
import type { SiteLink } from "./site-chrome";

/**
 * The link component a shared component links with. In the browser app it is the app's router link.
 * A server-rendered public page provides its own (decision 0011), so the same component links
 * correctly on both kinds of page.
 */
export const SiteLinkContext = createContext<SiteLink>(Link as SiteLink);

/** A link made with the page's link component. One component renders it, so a component that
 * links never creates a component while it renders. */
export function SiteLinkTo(props: ComponentProps<SiteLink>) {
  return createElement(useContext(SiteLinkContext), props);
}
