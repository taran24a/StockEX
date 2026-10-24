import type { Instrument } from "@tradewise/shared";

const instruments = [
  { symbol: "ALFA", name: "Alfa Industries", initialPricePaise: 12_500_000 },
  { symbol: "BRAVO", name: "Bravo Energy", initialPricePaise: 8_750_000 },
  { symbol: "CIRRUS", name: "Cirrus Technologies", initialPricePaise: 21_000_000 },
  { symbol: "DELTA", name: "Delta Foods", initialPricePaise: 4_250_000 },
  { symbol: "ECHO", name: "Echo Mobility", initialPricePaise: 6_800_000 }
] as const;

export function initialQuotes(now = new Date()): Instrument[] {
  return instruments.map(({ symbol, name, initialPricePaise }) => ({
    symbol,
    name,
    pricePaise: initialPricePaise,
    changePaise: 0,
    updatedAt: now.toISOString()
  }));
}

export function advanceQuotes(
  current: readonly Instrument[],
  random: () => number = Math.random,
  now = new Date()
): Instrument[] {
  return current.map((instrument) => {
    const basisPoints = Math.floor(random() * 201) - 100;
    const changePaise = Number(BigInt(instrument.pricePaise) * BigInt(basisPoints) / 10_000n);

    return {
      ...instrument,
      pricePaise: Math.max(1, instrument.pricePaise + changePaise),
      changePaise,
      updatedAt: now.toISOString()
    };
  });
}
