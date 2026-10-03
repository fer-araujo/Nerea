/**
 * Rounds half away from zero at `decimals` places, the way a person (or a
 * spreadsheet) rounds a sum by hand.
 *
 * `Math.round(x * 100) / 100` and `toFixed(2)` both trip over binary floating
 * point: 1.005 is stored as 1.00499999999999989..., so they answer 1.00 where a
 * calculator answers 1.01. Here the scaled value is first cleaned to 15
 * significant digits (the most a double can faithfully hold, which wipes the
 * representation noise) and only then rounded. Money and grams are ALWAYS
 * rounded through this function, so the same tie never rounds two ways.
 *
 * Non-finite input is returned untouched: garbage in must stay visibly
 * garbage instead of silently turning into 0. Callers validate before they
 * round.
 */
export function roundTo(value: number, decimals = 0): number {
  if (!Number.isFinite(value)) {
    return value;
  }

  const factor = 10 ** decimals;
  const rounded =
    Math.round(Number((Math.abs(value) * factor).toPrecision(15))) / factor;

  // `rounded !== 0` keeps a tiny negative from turning into -0.
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}
