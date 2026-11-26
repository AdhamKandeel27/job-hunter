import { readFileSync } from "node:fs";
import type { Usage } from "./types";

/** USD per 1 million tokens, optionally starting on a date (YYYY-MM-DD). */
export interface Price {
  from?: string;
  input: number;
  output: number;
}
export type PriceTable = Record<string, Price[]>;

/** Another provider's models to price the same work on: one for screening, one for judging. */
export interface Setup {
  provider: string;
  screen: string;
  judge: string;
}

/** Paid-tier prices from profile/prices.json. Empty if the file is missing or broken. */
export function loadPrices(): PriceTable {
  try {
    return JSON.parse(readFileSync("profile/prices.json", "utf8")).models ?? {};
  } catch {
    return {};
  }
}

export function loadSetups(): Setup[] {
  try {
    const setups = JSON.parse(readFileSync("profile/prices.json", "utf8")).setups;
    return Array.isArray(setups) ? setups.filter((s) => s?.screen && s?.judge) : [];
  } catch {
    return [];
  }
}

/** The price of a model on a given day, or undefined if it is not in the table. */
export function priceOn(prices: PriceTable, model: string, at: Date): Price | undefined {
  const day = at.toISOString().slice(0, 10);
  return (prices[model] ?? [])
    .filter((p) => !p.from || p.from <= day)
    .sort((a, b) => (a.from ?? "").localeCompare(b.from ?? ""))
    .at(-1);
}

/** The latest listed price of a model, even if it has not started yet. */
export function latestPrice(prices: PriceTable, model: string): Price | undefined {
  return [...(prices[model] ?? [])].sort((a, b) => (a.from ?? "").localeCompare(b.from ?? "")).at(-1);
}

export const priced = (tokens: { input: number; output: number }, p: Price) =>
  (tokens.input * p.input + tokens.output * p.output) / 1_000_000;

/** What a run's tokens cost on the paid tier at the prices of that day. */
export function costOf(usage: Usage, prices: PriceTable, at: Date): { usd: number; unpriced: string[] } {
  let usd = 0;
  const unpriced: string[] = [];
  for (const [model, u] of Object.entries(usage)) {
    const p = priceOn(prices, model, at);
    if (p) usd += priced(u, p);
    else unpriced.push(model);
  }
  return { usd, unpriced };
}

/** Small amounts need more decimals to mean anything. */
export function usd(n: number): string {
  if (n === 0) return "$0";
  return `$${n.toFixed(n < 0.1 ? 4 : n < 10 ? 3 : 2)}`;
}
