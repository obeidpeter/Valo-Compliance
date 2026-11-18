import {
  liveReleasedVersions,
  projectReleasedCatalogue,
  directorySearchItems,
} from "./valo-released-content";
export async function publicDiscovery() {
  const released = projectReleasedCatalogue(await liveReleasedVersions());
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
