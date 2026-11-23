import {
  getDownloadPremiumManualTemplateUrl,
  getDownloadReleasedTemplateUrl,
  type ReleasedTemplate,
} from "@workspace/api-client-react";
import { Download } from "lucide-react";
import { templateCheckoutPath } from "@/lib/template-checkout";
import { PublicLink } from "./public-link";

type Edition = Pick<ReleasedTemplate, "id" | "offer" | "formats" | "publicationMethod">;

export function PremiumTemplateDetailAction({ edition, owned }: { edition: Edition; owned: boolean }) {
  if (!owned) {
    return edition.offer ? (
      <PublicLink
        href={templateCheckoutPath(edition.offer.id)}
        className="btn btn-primary w-full"
        data-testid="detail-checkout"
      >
        Go to checkout
      </PublicLink>
    ) : null;
  }
  return edition.formats.map((format) => (
    <PublicLink
      key={format}
      href={
        edition.publicationMethod === "manual"
          ? getDownloadPremiumManualTemplateUrl(edition.id)
          : getDownloadReleasedTemplateUrl(edition.id, format)
      }
      className="btn btn-primary w-full"
      data-testid={"detail-download-" + format}
    >
      <Download className="h-4 w-4" aria-hidden />
      {edition.formats.length === 1 ? "Download" : format === "docx" ? "Download Word file" : "Download PDF"}
    </PublicLink>
  ));
}
