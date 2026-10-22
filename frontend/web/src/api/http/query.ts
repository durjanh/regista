export type QueryValue = string | number | undefined | null;

/** `?a=1&b=2` from the parameters that are set; empty when none are. */
export function qs(params: Record<string, QueryValue>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString();
}

/** One URL path segment (match ids, player keys and team ids can contain any character). */
export const seg = (value: string) => encodeURIComponent(value);

/** The live clock in whole seconds: endpoints that take an integer `upto_t` reject fractions. */
export const wholeSeconds = (t?: number) => (t !== undefined ? Math.floor(t) : undefined);
