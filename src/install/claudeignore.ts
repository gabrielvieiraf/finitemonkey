import { withoutCarriageReturn } from "../core/posix-path.js";

export const CLAUDEIGNORE_FILES = [".claudeignore", ".claude/.claudeignore"] as const;

const ruleFor = (raw: string): string | undefined => {
  const line = withoutCarriageReturn(raw).trim();
  if (line === "" || line.startsWith("#") || line.startsWith("!") || line.includes(")")) return undefined;
  const anchored = line.startsWith("/");
  const body = (anchored ? line.slice(1) : line).replace(/\/+$/, "");
  if (body === "" || body === "*" || body === "**") return undefined;
  const path = line.endsWith("/") ? `${body}/**` : body;
  return `Read(${anchored || body.includes("/") ? "./" : ""}${path})`;
};

export const claudeignoreRules = (texts: readonly (string | undefined)[]): readonly string[] => [
  ...new Set(
    texts
      .flatMap((text) => (text ?? "").split("\n"))
      .map(ruleFor)
      .filter((rule) => rule !== undefined),
  ),
];
