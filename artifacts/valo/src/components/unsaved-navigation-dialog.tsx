import { useEffect, useRef } from "react";
export function UnsavedNavigationDialog({
  open,
  busy,
  onSave,
  onDiscard,
  onStay,
  error,
  title,
  saveLabel,
  description,
}: {
  open: boolean;
  busy: boolean;
  onSave?: () => void;
  onDiscard: () => void;
  onStay: () => void;
  error?: string | undefined;
  title?: string;
  saveLabel?: string;
  description?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="max-w-md rounded-2xl border border-border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/40"
      aria-labelledby="unsaved-navigation-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onStay();
      }}
    >
      <h2 id="unsaved-navigation-title" className="font-display text-2xl">
        {title ?? (onSave ? "Save before leaving?" : "Leave without saving?")}
      </h2>
      <p className="mt-3 text-sm">
        {description ??
          (onSave
            ? "You have changes that are not saved, including any amounts you have not applied. Save them, discard them, or stay here."
            : "You have unsaved entries on this page. Stay here to finish, or leave and discard them.")}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {onSave && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={busy}
            onClick={onSave}
            data-testid="button-save-leave"
          >
            {busy ? "Saving…" : (saveLabel ?? "Save and leave")}
          </button>
        )}
        <button
          type="button"
          className={onSave ? "btn btn-ghost btn-sm" : "btn btn-primary btn-sm"}
          disabled={busy}
          onClick={onStay}
          data-testid="button-stay-editor"
        >
          Stay here
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={busy}
          onClick={onDiscard}
          data-testid="button-discard-leave"
        >
          Discard and leave
        </button>
      </div>
    </dialog>
  );
}
