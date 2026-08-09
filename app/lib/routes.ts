import { isCategoryId, type CategoryId } from "./data";

export type TrainerView = "training" | "review" | "progress";

/**
 * Paths keep their trailing slash to match the exported directory layout, so
 * links, canonical URLs and the sitemap all name the URL the host really
 * serves — no redirect hop, no canonical mismatch.
 */
export function trainingPath(category: CategoryId) {
  return category === "all" ? "/" : `/training/${category}/`;
}

export function viewPath(view: TrainerView, category: CategoryId) {
  return view === "training" ? trainingPath(category) : `/${view}/`;
}

export function routeState(pathname: string): { view: TrainerView; category?: CategoryId } | null {
  if (pathname === "/") return { view: "training", category: "all" };
  if (pathname === "/review" || pathname === "/review/") return { view: "review" };
  if (pathname === "/progress" || pathname === "/progress/") return { view: "progress" };
  const match = pathname.match(/^\/training\/([^/]+)\/?$/);
  return match && isCategoryId(match[1]) ? { view: "training", category: match[1] } : null;
}
