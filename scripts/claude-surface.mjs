import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const isWindows = process.platform === "win32";

const SURFACE = [
  {
    path: [],
    flags: [
      "--version",
      "--print",
      "--model",
      "--permission-mode",
      "--disallowed-tools",
      "--max-budget-usd",
      "--plugin-dir",
      "--settings",
      "--output-format",
      "--no-session-persistence",
    ],
  },
  { path: ["plugin", "validate"], flags: ["--strict"] },
  { path: ["plugin", "marketplace", "add"], flags: ["--scope"] },
  { path: ["plugin", "install"], flags: [] },
  { path: ["plugin", "disable"], flags: [] },
  { path: ["plugin", "uninstall"], flags: [] },
];

const claude = (args) =>
  spawnSync(isWindows ? "claude.cmd" : "claude", args, { encoding: "utf8", shell: isWindows, timeout: 60_000 });

const version = claude(["--version"]);
if (version.status !== 0) {
  console.error("claude --version failed; is Claude Code installed?");
  process.exit(1);
}

const problems = [];
for (const { path, flags } of SURFACE) {
  const help = claude([...path, "--help"]);
  const text = `${help.stdout}${help.stderr}`;
  if (help.status !== 0) problems.push(`claude ${path.join(" ")} --help exited ${String(help.status)}`);
  for (const flag of flags) {
    if (!text.includes(flag)) problems.push(`claude ${[...path, flag].join(" ")} is gone from --help`);
  }
}

const lines = [
  "### Claude Code surface",
  "",
  `Version: \`${version.stdout.trim()}\``,
  "",
  `${String(SURFACE.reduce((sum, item) => sum + item.flags.length, 0))} flags in ${String(SURFACE.length)} commands checked.`,
  ...(problems.length === 0 ? ["All present."] : ["", ...problems.map((problem) => `- ${problem}`)]),
  "",
];
console.log(lines.join("\n"));
const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary) appendFileSync(summary, `${lines.join("\n")}\n`);
if (problems.length > 0) process.exit(1);
