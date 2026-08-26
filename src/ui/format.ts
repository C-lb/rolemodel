/** Display and input formatting for money figures. Kept free of React so both can be unit-tested. */

/** The glyph shown where a figure is absent. Not prose: it stands in for a missing number. */
const ABSENT = "—";

export function formatMoney(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return ABSENT;
  const abs = Math.abs(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return value < 0 ? `(${abs})` : abs;
}

/**
 * Parse a figure as a person would type it: grouped digits, a currency symbol,
 * a leading minus, or accounting parentheses for a negative. Anything else is
 * rejected rather than coerced, so a typo can never become a silent zero.
 */
export function parseMoney(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;

  const parenthesised = /^\((.*)\)$/.exec(trimmed);
  const body = parenthesised ? parenthesised[1] : trimmed;
  const cleaned = body.replace(/[$£€\s,]/g, "");

  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return parenthesised ? -Math.abs(n) : n;
}
