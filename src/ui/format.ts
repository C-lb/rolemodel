/** Display and input formatting for money figures. Kept free of React so both can be unit-tested. */

import type { DriverUnit } from "@/model/forecast/drivers";

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

/**
 * Ratios are formatted by unit, not by magnitude: 1.84x, 38.2%, 68 days, and money
 * through the same formatter the statements use, so one figure never appears in two
 * shapes on one screen.
 */
export function formatRatio(value: number, unit: "x" | "percent" | "days" | "currency"): string {
  if (!Number.isFinite(value)) return ABSENT;
  switch (unit) {
    case "x":
      return `${value.toFixed(2)}x`;
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "days": {
      const days = Math.round(value);
      return `${days} ${Math.abs(days) === 1 ? "day" : "days"}`;
    }
    case "currency":
      return formatMoney(value);
  }
}

/**
 * Driver display, storage and editing (spec section 10: "Percent drivers display as
 * percentages and store as decimals"). A driver's stored value is always the decimal
 * the engine consumes; these three functions are the only place that decimal is ever
 * turned into or read back from what a person types or sees.
 *
 * The round trip is the part that breaks: a percent driver stored as 0.0345 must come
 * back out of the editor as 0.0345, not 3.45 or 0.000345, however many times it is
 * opened and closed unedited. `driverEditValue` and `parseDriverValue` are exact
 * inverses of each other for that reason — one multiplies by 100, the other divides by
 * it, and nothing in between rounds away the difference.
 */
export function formatDriverValue(value: number | undefined, unit: DriverUnit): string {
  if (value === undefined || Number.isNaN(value)) return "—";
  switch (unit) {
    case "percent":
      return `${(value * 100).toFixed(2)}%`;
    case "days":
      return `${Math.round(value)}`;
    case "currency":
      return formatMoney(value);
  }
}

/** The plain number a click-to-edit field seeds its draft with: no % sign, no grouping. */
export function driverEditValue(value: number, unit: DriverUnit): string {
  switch (unit) {
    case "percent": {
      // A plain `value * 100` surfaces binary floating-point noise a user never typed:
      // 0.035 * 100 is 3.5000000000000004, not 3.5. Rounding to 12 significant digits
      // clears that noise (well below the 2 decimal places this unit is ever edited to)
      // without truncating a genuinely precise seeded value.
      const scaled = Number((value * 100).toPrecision(12));
      return String(scaled);
    }
    case "days":
      return String(value);
    case "currency":
      return String(value);
  }
}

/** Parses what a person typed for a driver back into the decimal the engine stores. */
export function parseDriverValue(input: string, unit: DriverUnit): number | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  switch (unit) {
    case "percent": {
      const cleaned = trimmed.replace(/%/g, "").trim();
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
      const n = Number(cleaned);
      return Number.isFinite(n) ? n / 100 : null;
    }
    case "days": {
      if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }
    case "currency":
      return parseMoney(trimmed);
  }
}
