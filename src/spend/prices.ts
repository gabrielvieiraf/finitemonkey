import { configMap, type ConfigTree } from "../git/project-config.js";

export interface Price {
  readonly input: number;
  readonly output: number;
}

export const PRICE_SOURCE = "Anthropic API prices per million tokens, list of 2026-06-24";

export const CACHE_WRITE_FACTOR = 1.25;
export const CACHE_READ_FACTOR = 0.1;

export const DEFAULT_PRICES: Readonly<Record<string, Price>> = {
  "claude-fable": { input: 10, output: 50 },
  "claude-mythos": { input: 10, output: 50 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-opus": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet": { input: 3, output: 15 },
  "claude-haiku": { input: 1, output: 5 },
};

const FALLBACK: Price = { input: 5, output: 25 };

const parsePrice = (text: string): Price | undefined => {
  const [input, output] = text.split(/[,/ ]+/).map(Number);
  return input !== undefined && output !== undefined && input >= 0 && output >= 0 && Number.isFinite(input + output)
    ? { input, output }
    : undefined;
};

export const priceTable = (config: ConfigTree): Readonly<Record<string, Price>> => ({
  ...DEFAULT_PRICES,
  ...Object.fromEntries(
    Object.entries(configMap(config, "budget", "prices")).flatMap(([model, text]) => {
      const price = parsePrice(text);
      return price === undefined ? [] : [[model, price] as const];
    }),
  ),
});

export const priceOf = (table: Readonly<Record<string, Price>>, model: string): Price => {
  const prefix = Object.keys(table)
    .filter((key) => model.startsWith(key))
    .sort((a, b) => b.length - a.length)[0];
  return prefix === undefined ? FALLBACK : (table[prefix] ?? FALLBACK);
};

export interface Usage {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

export const usdOf = (price: Price, usage: Usage): number =>
  (usage.input * price.input +
    usage.cacheWrite * price.input * CACHE_WRITE_FACTOR +
    usage.cacheRead * price.input * CACHE_READ_FACTOR +
    usage.output * price.output) /
  1_000_000;
