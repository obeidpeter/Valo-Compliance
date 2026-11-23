import {
  liveReleasedVersions,
  projectReleasedCatalogue,
  directorySearchItems,
} from "./valo-released-content";
import { releasedManualEntries } from "../manual-library";
import { manualCatalogue } from "./manual-presentation";
export async function publicDiscovery() {
  const [existing, manual] = await Promise.all([
    liveReleasedVersions(),
    releasedManualEntries({ summaryOnly: true }),
  ]);
  const released = [...projectReleasedCatalogue(existing), ...manual.map(manualCatalogue)];
  return {
    items: [...released, ...directorySearchItems()]
      .map((i) => ({
        path: i.href!.split("?")[0]!,
        title: i.title,
        description: i.summary,
        modifiedAt: i.reviewedAt ?? null,
      }))
      .filter((item, index, all) => all.findIndex((x) => x.path === item.path) === index),
  };
}
