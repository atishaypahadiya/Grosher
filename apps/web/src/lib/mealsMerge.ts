// Cook mode's reviewed lines into the current list. Apart from lib/meals.ts so the list screen can merge without
// loading the dish table, which comes with the meal sheet.

import { normalize, singularize, stripQuantity } from "@grosher/core";

const itemKey = (s: string) => singularize(stripQuantity(s));

/**
 * A plain item already there for the same thing ("onions") gives way to the line with its quantity ("Onions × 6");
 * an item with a quantity of its own stays, and the line is not added twice.
 */
export function mergeIntoList(current: string[], lines: string[]): string[] {
  const out = [...current];
  for (const line of lines) {
    const k = itemKey(line);
    if (!k) continue;
    const at = out.findIndex((n) => itemKey(n) === k);
    if (at < 0) out.push(line);
    else if (normalize(out[at]) === k || singularize(normalize(out[at])) === k) out[at] = line;
  }
  return out;
}
