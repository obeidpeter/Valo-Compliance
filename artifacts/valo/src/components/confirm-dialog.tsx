import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Asks before an action that discards something the customer entered. The button that keeps
 * everything comes first, so it takes the focus when the dialog opens, and Escape does the same.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  keep,
  confirm,
  onKeep,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  /** The button that leaves everything as it is. */
  keep: string;
  /** The button that goes ahead. */
  confirm: string;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="max-w-md rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onKeep();
      }}
      data-testid="dialog-confirm"
    >
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-3 text-sm leading-relaxed">{children}</div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={onKeep} data-testid="button-keep">
          {keep}
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onConfirm}
          data-testid="button-confirm"
        >
          {confirm}
        </button>
      </div>
    </dialog>
  );
}
