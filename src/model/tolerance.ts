const RELATIVE = 0.005;
const ABSOLUTE_FLOOR = 1;

/** True when two money figures agree within rounding noise. Never compare money with ===. */
export function closeEnough(a: number, b: number): boolean {
  const scale = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= Math.max(ABSOLUTE_FLOOR, scale * RELATIVE);
}
