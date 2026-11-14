// Page indices inside the app are zero-based; -1 names the cover.
export type Route = { th?: string; i: number };

export function parseRoute(path: string): Route | null {
  if (path === "/") return { i: -1 };
  // Keep the thread id rule in step with internal/library's idRe.
  const match = /^\/c\/([a-z0-9]{6,24})(?:\/([0-9]+))?$/.exec(path);
  if (!match || match[0] !== path) return null;
  const page = Math.min(Number(match[2] ?? 1), Number.MAX_SAFE_INTEGER);
  if (page < 1) return null;
  return { th: match[1], i: page - 1 };
}

export function routeURL({ th, i }: Route, search = ""): string {
  const path = th && i >= 0 ? `/c/${th}${i > 0 ? `/${i + 1}` : ""}` : "/";
  return path + search;
}
