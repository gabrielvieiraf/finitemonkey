// VAT rate for the store, as a fraction (0.1 is 10%).
exports.VAT_RATE = {{bps}} / 10000;

const BASIS_POINTS = BigInt({{bps}});

exports.vatOf = (netCents) => {
  const scaled = BigInt(netCents) * BASIS_POINTS;
  const quotient = scaled / 10000n;
  const remainder = scaled % 10000n;
  return Number(remainder * 2n >= 10000n ? quotient + 1n : quotient);
};
