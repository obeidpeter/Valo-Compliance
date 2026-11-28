import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast";
import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

/**
 * The messages that confirm an action ("Profile saved"). One shows for a few seconds, over the top
 * of the page and under the site's header:
 *
 * - under the header, wherever the header is, so that the header and its menu stay in reach, and at
 *   the top, so that it is clear of the actions a screen holds at its foot (the button just pressed);
 * - gone as soon as the keyboard has moved on to another part of the page, so that the control that
 *   takes the focus is not hidden under it (WCAG 2.2, Focus Not Obscured). It stays while the
 *   keyboard is in the message itself, which F8 reaches, and which follows the page's last control.
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  const viewport = useRef<HTMLOListElement>(null);
  const showing = toasts.some((toast) => toast.open !== false);
  const close = useRef(dismiss);
  close.current = dismiss;

  useEffect(() => {
    if (!showing) return;
    const place = () => {
      const foot = document.querySelector("header")?.getBoundingClientRect().bottom ?? 0;
      viewport.current?.style.setProperty("top", `${Math.max(0, foot)}px`);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      // Decided once the key has moved the focus, never before: a Tab that moves into the message
      // must not find it going.
      window.setTimeout(() => {
        if (!viewport.current?.contains(document.activeElement)) close.current();
      });
    };
    place();
    window.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [showing]);

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} data-testid="toast" {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport ref={viewport} />
    </ToastProvider>
  );
}
