export const HEADER_RULES = ["csp", "hsts", "nosniff", "referrer", "frame-ancestors"] as const;

export type HeaderRule = (typeof HEADER_RULES)[number];

export type HeaderMap = Readonly<Record<string, string>>;

export interface RouteHeaders {
  readonly route: string;
  readonly status: number;
  readonly headers: HeaderMap;
}

export interface HeaderIssue {
  readonly route: string;
  readonly rule: HeaderRule;
}

export const WATCHED = [
  "content-security-policy",
  "strict-transport-security",
  "x-content-type-options",
  "referrer-policy",
  "x-frame-options",
] as const;

const csp = (headers: HeaderMap): string => headers["content-security-policy"] ?? "";

const present = (rule: HeaderRule, headers: HeaderMap): boolean => {
  switch (rule) {
    case "csp":
      return csp(headers).trim() !== "";
    case "hsts":
      return /max-age=\d+/i.test(headers["strict-transport-security"] ?? "");
    case "nosniff":
      return (headers["x-content-type-options"] ?? "").trim().toLowerCase() === "nosniff";
    case "referrer":
      return (headers["referrer-policy"] ?? "").trim() !== "";
    case "frame-ancestors":
      return (
        /frame-ancestors\s/i.test(csp(headers)) ||
        /^(deny|sameorigin)$/i.test((headers["x-frame-options"] ?? "").trim())
      );
  }
};

export const missingHeaders = (results: readonly RouteHeaders[], https: boolean): readonly HeaderIssue[] =>
  results.flatMap((result) =>
    HEADER_RULES.filter((rule) => (rule !== "hsts" || https) && !present(rule, result.headers)).map((rule) => ({
      route: result.route,
      rule,
    })),
  );

export const watchedOnly = (headers: Readonly<Record<string, string>>): HeaderMap =>
  Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]): [string, string] => [name.toLowerCase(), value])
      .filter(([name]) => WATCHED.some((watched) => watched === name)),
  );

export const parseHeaderBlock = (raw: string): { readonly status: number; readonly headers: HeaderMap } => {
  const blocks = raw
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n\s*\n/);
  const last = blocks.at(-1) ?? "";
  const [first = "", ...rest] = last.split("\n");
  const status = Number.parseInt(/^HTTP\/\S+\s+(\d{3})/.exec(first)?.[1] ?? "0", 10);
  const pairs = rest.flatMap((line): [string, string][] => {
    const index = line.indexOf(":");
    return index <= 0 ? [] : [[line.slice(0, index).trim(), line.slice(index + 1).trim()]];
  });
  return { status, headers: watchedOnly(Object.fromEntries(pairs)) };
};
