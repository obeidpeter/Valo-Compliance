import { FILE_FORMAT_NAMES } from "./file-formats";

type ShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
};

export function canUseWebShare(nav?: ShareNavigator | null): boolean {
  const target = nav === undefined ? (typeof navigator !== "undefined" ? navigator : null) : nav;
  return Boolean(target && typeof target.share === "function");
}

export function exportMimeType(format: "docx" | "pdf"): string {
  return format === "pdf"
    ? "application/pdf"
    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

export function exportFileName(title: string, format: "docx" | "pdf"): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "document"}.${format}`;
}

/**
 * Shares a ready exported file using the browser's native Web Share API (attaching the PDF/Word
 * file directly when the device supports file sharing, such as Android/iOS WhatsApp or Mail, and
 * falling back to sharing the document link). Returns `"shared"`, `"cancelled"`, or `"error"`.
 */
export async function shareExportFile(
  options: { title: string; format: "docx" | "pdf"; downloadUrl: string },
  deps?: { nav?: ShareNavigator | null; fetchImpl?: typeof fetch },
): Promise<"shared" | "cancelled" | "error"> {
  const nav = deps?.nav === undefined ? (typeof navigator !== "undefined" ? navigator : null) : deps.nav;
  if (!nav || typeof nav.share !== "function") return "error";

  const fileName = exportFileName(options.title, options.format);
  const label = `${options.title} (${FILE_FORMAT_NAMES[options.format]})`;

  try {
    const fetcher = deps?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
    if (fetcher && typeof File !== "undefined" && typeof nav.canShare === "function") {
      const response = await fetcher(options.downloadUrl, { credentials: "same-origin" });
      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], fileName, { type: exportMimeType(options.format) });
        if (nav.canShare({ files: [file] })) {
          await nav.share({ title: label, files: [file] });
          return "shared";
        }
      }
    }
    await nav.share({ title: label, url: options.downloadUrl });
    return "shared";
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return "cancelled";
    return "error";
  }
}
