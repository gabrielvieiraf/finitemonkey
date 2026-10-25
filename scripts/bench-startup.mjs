import { spawnSync } from "node:child_process";

import { OUTFILE } from "./bundle.mjs";

const runs = Number.parseInt(process.env.FM_BENCH_RUNS ?? "20", 10);

const time = (args, input) => {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const start = process.hrtime.bigint();
    const result = spawnSync(process.execPath, [OUTFILE, ...args], { input, encoding: "utf8" });
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (result.status !== 0) throw new Error(`${args.join(" ")} exited ${result.status}: ${result.stderr}`);
  }
  samples.sort((a, b) => a - b);
  const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))].toFixed(1);
  return { median: pick(0.5), p90: pick(0.9), min: samples[0].toFixed(1) };
};

const baseline = (() => {
  const samples = [];
  for (let index = 0; index < runs; index += 1) {
    const start = process.hrtime.bigint();
    spawnSync(process.execPath, ["-e", "0"]);
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)].toFixed(1);
})();

const payload = JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } });
const report = {
  node: process.version,
  runs,
  nodeBaselineMedianMs: baseline,
  version: time(["--version"]),
  hookPreToolUse: time(["hook", "PreToolUse"], payload),
  helpJson: time(["help", "--json"]),
};
console.log(JSON.stringify(report, null, 2));
