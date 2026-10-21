// A list in the URL, routed at once: the project page's "Open this in the app" links here.
//   ?sample=<hero list id or name>   one of the store's shipped lists (e.g. ?sample=weekly-staples)
//   ?list=milk,eggs,bread            the items themselves (commas, semicolons or new lines between them)
// At most 40 items of 60 characters (the resolver's own limits). Nothing is stored beyond the usual draft.

export const MAX_ITEMS = 40;
export const MAX_CHARS = 60;

/** the items a link asks for, or null when it asks for none */
export function linkedList(search: string, lists: { id: string; name: string; items: string[] }[] = []): string[] | null {
  const q = new URLSearchParams(search);
  const sample = q.get("sample");
  if (sample) {
    const key = sample.trim().toLowerCase();
    const hit = lists.find((l) => l.id.toLowerCase() === key || l.name.toLowerCase() === key);
    return hit ? hit.items.slice(0, MAX_ITEMS) : null;
  }
  const list = q.get("list");
  if (!list) return null;
  const items = list
    .split(/[,;\n]/)
    .map((s) => s.trim().slice(0, MAX_CHARS))
    .filter(Boolean);
  return items.length ? [...new Set(items)].slice(0, MAX_ITEMS) : null;
}

/** the URL without the link's parameters, so a reload resumes the trip instead of starting it again */
export function withoutLink(href: string): string {
  const u = new URL(href);
  u.searchParams.delete("list");
  u.searchParams.delete("sample");
  return u.pathname + (u.search ? u.search : "") + u.hash;
}
