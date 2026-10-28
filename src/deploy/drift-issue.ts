import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import type { HostDrift } from "./drift.js";
import { GH_TIMEOUT_MS } from "./github.js";

export type IssueOutcome =
  | { readonly kind: "created" | "updated"; readonly number?: number }
  | { readonly kind: "failed"; readonly detail: string };

export const driftTitle = (branch: string): string => `Production diverged from ${branch}`;

const gh = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath, args: readonly string[]) =>
  runtime.exec({ command: "gh", args, cwd, timeoutMs: GH_TIMEOUT_MS });

export const driftBody = (branch: string, expected: string, hosts: readonly HostDrift[], at: string): string =>
  [
    `Checked at ${at} by \`finitemonkey deploy check\`. Expected \`${expected.slice(0, 12)}\` from \`${branch}\`.`,
    "",
    ...hosts
      .filter((host) => host.state === "diverged")
      .flatMap((host) => [
        `- ${host.alias}: running ${host.running.map((revision) => `\`${revision.slice(0, 12)}\``).join(", ") || "-"}` +
          (host.head === undefined ? "" : `, checkout at \`${host.head.slice(0, 12)}\``),
        ...host.edits.map((edit) => `  - local edit: \`${edit}\``),
      ]),
    "",
    "Redeploy from the branch instead of editing the server by hand.",
  ].join("\n");

const openIssue = (runtime: Pick<Runtime, "exec">, cwd: AbsolutePath, title: string): number | undefined | "error" => {
  const listed = gh(runtime, cwd, [
    "issue",
    "list",
    "--state",
    "open",
    "--search",
    `"${title}" in:title`,
    "--json",
    "number,title",
    "--limit",
    "20",
  ]);
  if (!listed.found || listed.exitCode !== 0) return "error";
  const parsed = parseJson(listed.stdout);
  if (!parsed.ok || !Array.isArray(parsed.value)) return "error";
  const items: readonly unknown[] = parsed.value;
  const found = items.find((item) => isRecord(item) && item["title"] === title);
  return isRecord(found) && typeof found["number"] === "number" ? found["number"] : undefined;
};

export const reportDrift = (
  runtime: Pick<Runtime, "exec">,
  cwd: AbsolutePath,
  title: string,
  body: string,
): IssueOutcome => {
  const existing = openIssue(runtime, cwd, title);
  if (existing === "error") return { kind: "failed", detail: "gh issue list" };
  const result =
    existing === undefined
      ? gh(runtime, cwd, ["issue", "create", "--title", title, "--body", body])
      : gh(runtime, cwd, ["issue", "comment", String(existing), "--body", body]);
  if (!result.found || result.exitCode !== 0)
    return { kind: "failed", detail: (result.stderr.trim() || "gh issue").slice(0, 160) };
  return existing === undefined ? { kind: "created" } : { kind: "updated", number: existing };
};
