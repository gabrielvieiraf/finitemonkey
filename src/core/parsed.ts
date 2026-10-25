export type Parsed<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const accept = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

export const reject = <E>(error: E): { readonly ok: false; readonly error: E } => ({ ok: false, error });

export type JsonObject = Readonly<Record<string, unknown>>;

export const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseJson = (text: string): Parsed<unknown> => {
  try {
    return accept(JSON.parse(text) as unknown);
  } catch (error) {
    return reject(error instanceof Error ? error.message : String(error));
  }
};

export const parseJsonObject = (text: string): Parsed<JsonObject> => {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  return isRecord(parsed.value) ? accept(parsed.value) : reject("expected a JSON object");
};

export const optionalString = (record: JsonObject, key: string): string | undefined => {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
};
