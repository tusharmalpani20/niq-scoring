/** Decimal inputs are compared as ratios so binary floating-point error cannot move a boundary. */
function fraction(value: number): [bigint, bigint] {
  const [mantissa, exponent = "0"] = value.toString().split("e");
  const decimals = mantissa!.split(".")[1]?.length ?? 0;
  const power = Number(exponent) - decimals;
  const integer = BigInt(mantissa!.replace(".", ""));
  return power >= 0 ? [integer * 10n ** BigInt(power), 1n] : [integer, 10n ** BigInt(-power)];
}

export function weightLossInRange(previous: number, current: number, range: { min: number | null; max: number | null; minInclusive: boolean; maxInclusive: boolean }): boolean {
  const [pn, pd] = fraction(previous);
  const [cn, cd] = fraction(current);
  // (previous-current)/previous*100, with a positive denominator (weights validated upstream).
  const numerator = (pn * cd - cn * pd) * 100n;
  const denominator = cd * pn;
  const compare = (boundary: number) => {
    const [bn, bd] = fraction(boundary);
    const difference = numerator * bd - bn * denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  };
  if (range.min !== null && (compare(range.min) < 0 || compare(range.min) === 0 && !range.minInclusive)) return false;
  if (range.max !== null && (compare(range.max) > 0 || compare(range.max) === 0 && !range.maxInclusive)) return false;
  return true;
}
