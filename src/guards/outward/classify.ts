import { basename } from "node:path";

import { commandEffect, type EffectContext } from "../../approve/effect.js";
import type { ShellCommand } from "../../shell/types.js";

const DEPLOYERS: ReadonlySet<string> = new Set([
  "vercel",
  "netlify",
  "fly",
  "flyctl",
  "heroku",
  "firebase",
  "wrangler",
  "railway",
  "render",
  "doctl",
  "eb",
  "serverless",
  "sls",
  "pulumi",
  "gcloud",
  "az",
  "aws",
]);
const DEPLOY_VERBS: ReadonlySet<string> = new Set(["deploy", "publish", "up", "release", "push", "upload", "promote"]);
const PUBLISHERS: ReadonlySet<string> = new Set(["npm", "pnpm", "yarn", "bun", "cargo", "gem", "twine", "poetry"]);
const PUBLISH_VERBS: ReadonlySet<string> = new Set(["publish", "push", "upload"]);
const APPLIERS: Readonly<Record<string, ReadonlySet<string>>> = {
  terraform: new Set(["apply", "destroy"]),
  tofu: new Set(["apply", "destroy"]),
  kubectl: new Set(["apply", "create", "replace", "patch", "delete", "rollout"]),
  helm: new Set(["install", "upgrade", "uninstall", "rollback"]),
  docker: new Set(["push"]),
  podman: new Set(["push"]),
};

const programOf = (command: ShellCommand): string =>
  basename(command.program.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.(?:exe|cmd)$/, "");

const words = (args: readonly string[]): readonly string[] => args.filter((arg) => !arg.startsWith("-"));

const named = (command: ShellCommand): string | undefined => {
  const program = programOf(command);
  const [sub = "", next = ""] = words(command.args);
  if (program === "git" && sub === "push") return "git push";
  if (program === "gh" && sub === "release" && next === "create") return "gh release create";
  if (PUBLISHERS.has(program) && PUBLISH_VERBS.has(sub)) return `${program} ${sub}`;
  if (APPLIERS[program]?.has(sub) === true) return `${program} ${sub}`;
  if (program === "vercel" && (sub === "" || command.args.includes("--prod"))) return "vercel";
  const verb = words(command.args).find((word) => DEPLOY_VERBS.has(word));
  return DEPLOYERS.has(program) && verb !== undefined ? `${program} ${verb}` : undefined;
};

export const outwardAction = (command: ShellCommand, context: EffectContext): string | undefined => {
  const action = named(command);
  if (action !== undefined) return action;
  const effect = commandEffect(command, context);
  if (effect.effect !== "sends") return undefined;
  return effect.host === undefined ? programOf(command) : `${programOf(command)} ${effect.host}`;
};

export const firstOutward = (commands: readonly ShellCommand[], context: EffectContext): string | undefined => {
  for (const command of commands) {
    const action = outwardAction(command, context);
    if (action !== undefined) return action;
  }
  return undefined;
};
