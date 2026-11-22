import type { PublicItem } from "@workspace/api-client-react";
import { templateCheckoutPath } from "../lib/template-checkout";
import { PublicLink } from "./public-link";

type PremiumCard = Pick<PublicItem, "id" | "title" | "priceId" | "premiumDownloadPath">;

export function PremiumTemplateCardAction({
  item,
  owned,
}: {
  item: PremiumCard;
  owned: ReadonlySet<string>;
}) {
  const download = owned.has(item.id) ? item.premiumDownloadPath : undefined;
  const href = download ?? (item.priceId && templateCheckoutPath(item.priceId));
  if (!href) return null;
  return (
    <div className="px-5 pb-5">
      <PublicLink
        href={href}
        className="btn btn-primary btn-sm"
        data-testid={download ? "card-download" : "card-checkout"}
      >
        {download ? "Download" : "Go to checkout"}
        <span className="sr-only">
          {download ? " " : " for "}
          {item.title}
        </span>
      </PublicLink>
    </div>
  );
}
