/**
 * Shapes shared across the ratio layer. Kept separate from the library so the
 * computation engine can depend on the types without pulling in 25 definitions.
 */

export const RATIO_FAMILIES = [
  "liquidity",
  "leverage",
  "efficiency",
  "profitability",
  "coverage",
] as const;

export type RatioFamily = (typeof RATIO_FAMILIES)[number];

/** Drives formatting, not arithmetic. `x` is a multiple, `percent` a rate, `currency` a money amount. */
export type RatioUnit = "x" | "percent" | "days" | "currency";

/** Which way is generally favourable. `context` means it depends on the business. */
export type RatioDirection = "higher" | "lower" | "context";

export interface RatioDef {
  key: string;
  family: RatioFamily;
  label: string;
  /** Parsed by the expression module. Identifiers are canonical line items or other ratio keys. */
  expression: string;
  unit: RatioUnit;
  direction: RatioDirection;
  /** Member of the core twelve the focus toggle narrows to. */
  isCore: boolean;
  /** Authored, deterministic. What it measures and how it is computed. */
  definition: string;
  /** The standard warning that belongs next to the number. */
  caveat: string;
  /**
   * True where the raw quotient is a fraction of a period and must be multiplied by the
   * period's day count. Set on DSO, DIO and DPO; deliberately false on the cash
   * conversion cycle, which sums three figures already expressed in days.
   */
  dayScaled: boolean;
  /**
   * True where a negative denominator makes the result meaningless rather than merely
   * unusual: a negative-equity ROE reads as a healthy return and is the opposite.
   */
  denominatorMustBePositive: boolean;
}

/** Workspace-level choice for balance-sheet denominators in flow-over-stock ratios. */
export type AveragingMode = "average" | "ending";
