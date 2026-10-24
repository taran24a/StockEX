const integerFormatter = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

export function formatPaise(paise: number): string {
  if (!Number.isSafeInteger(paise)) {
    throw new RangeError("Currency amount must be a safe integer number of paise");
  }
  const negative = paise < 0;
  const absolute = Math.abs(paise);
  const rupees = Math.floor(absolute / 100);
  const remainder = String(absolute % 100).padStart(2, "0");
  return `${negative ? "−" : ""}₹${integerFormatter.format(rupees)}.${remainder}`;
}
