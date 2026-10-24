import type { Quote } from "@tradewise/shared";

export const marketInstruments = [
  { symbol: "ALFA", name: "Alfa Compute Systems", sector: "Technology", initialPricePaise: 12_500_000 },
  { symbol: "CIRRUS", name: "Cirrus Technologies", sector: "Technology", initialPricePaise: 21_000_000 },
  { symbol: "BYTEWAVE", name: "Bytewave Networks", sector: "Technology", initialPricePaise: 9_875_000 },
  { symbol: "DELTA", name: "Delta National Bank", sector: "Banking", initialPricePaise: 4_250_000 },
  { symbol: "PIONEER", name: "Pioneer Urban Bank", sector: "Banking", initialPricePaise: 12_650_000 },
  { symbol: "MERIDIAN", name: "Meridian Credit Group", sector: "Banking", initialPricePaise: 5_980_000 },
  { symbol: "BRAVO", name: "Bravo Energy", sector: "Energy", initialPricePaise: 8_750_000 },
  { symbol: "SOLSTICE", name: "Solstice Renewables", sector: "Energy", initialPricePaise: 16_800_000 },
  { symbol: "BLUEPEAK", name: "Bluepeak Petroleum", sector: "Energy", initialPricePaise: 21_150_000 },
  { symbol: "VITALIS", name: "Vitalis Therapeutics", sector: "Pharma", initialPricePaise: 11_200_000 },
  { symbol: "GENEVIA", name: "Genevia Biologics", sector: "Pharma", initialPricePaise: 6_750_000 },
  { symbol: "ORCHID", name: "Orchid Life Sciences", sector: "Pharma", initialPricePaise: 14_390_000 },
  { symbol: "ECHO", name: "Echo Mobility", sector: "Auto", initialPricePaise: 6_800_000 },
  { symbol: "MOTION", name: "Motion Electric Vehicles", sector: "Auto", initialPricePaise: 19_550_000 },
  { symbol: "ROADSTAR", name: "Roadstar Mobility", sector: "Auto", initialPricePaise: 10_480_000 }
] as const;

export function initialQuotes(now = new Date()): Quote[] {
  return marketInstruments.map(({ symbol, name, initialPricePaise }) => ({
    symbol,
    name,
    pricePaise: initialPricePaise,
    changePaise: 0,
    updatedAt: now.toISOString()
  }));
}

export function advanceQuotes(
  current: readonly Quote[],
  random: () => number = Math.random,
  now = new Date()
): Quote[] {
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
