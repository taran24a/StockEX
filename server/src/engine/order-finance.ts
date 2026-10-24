export function calculateFillFee(pricePaise: number, quantity: number): bigint {
  // Fee policy: 0.03% per fill, rounded up to a paise, with a one-paise minimum.
  const notional = BigInt(pricePaise) * BigInt(quantity);
  const fee = (notional * 3n + 9_999n) / 10_000n;
  return fee < 1n ? 1n : fee;
}

export function calculateBuyReservation(quantity: number, pricePaise: number): bigint {
  if (quantity === 0) {
    return 0n;
  }
  const notional = BigInt(quantity) * BigInt(pricePaise);
  const proportionalFee = (notional * 3n + 9_999n) / 10_000n;
  const worstFee = proportionalFee > BigInt(quantity) ? proportionalFee : BigInt(quantity);
  return notional + worstFee;
}
