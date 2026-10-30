import { dirname, join } from "node:path";

import { type AbsolutePath, toAbsolutePath } from "../core/brand.js";
import { isRecord, parseJson } from "../core/parsed.js";
import type { Runtime } from "../core/runtime.js";
import { configAt, type ConfigTree } from "../git/project-config.js";
import type { Example } from "../task/examples.js";
import type { TaskContract } from "../task/types.js";

export const BLIND_FEATURE = "blind-tests";
export const BLIND_PACKET_SCHEMA = "finitemonkey/blind-packet@1";
export const DEFAULT_MAX_TESTS = 5;
const WRITER_TIMEOUT_MS = 15 * 60_000;
const TEST_TIMEOUT_MS = 120_000;
const SAFE_FILE = /^(?!\/)(?!.*\.\.)(?![A-Za-z]:)[A-Za-z0-9._\-/]+$/;

export interface PacketCriterion {
  readonly id: string;
  readonly kind: string;
  readonly description?: string;
}

export interface BlindPacket {
  readonly schema: typeof BLIND_PACKET_SCHEMA;
  readonly task: string;
  readonly goal: string;
  readonly base: string;
  readonly criteria: readonly PacketCriterion[];
  readonly examples: readonly { readonly says: string; readonly input: string; readonly expect: string }[];
}

export interface BlindTest {
  readonly name: string;
  readonly file: string;
  readonly content: string;
  readonly run: string;
}

export type BlindWriter = (packet: BlindPacket, baseDir: AbsolutePath) => readonly BlindTest[] | undefined;

const DESCRIBED = new Set(["manual", "command", "tests", "runtime", "golden", "examples", "scenarios"]);

export const buildPacket = (contract: TaskContract, base: string, examples: readonly Example[]): BlindPacket => ({
  schema: BLIND_PACKET_SCHEMA,
  task: contract.id,
  goal: contract.goal,
  base,
  criteria: contract.acceptance
    .filter((check) => DESCRIBED.has(check.kind))
    .map((check) => ({
      id: check.id,
      kind: check.kind,
      ...(check.description === undefined ? {} : { description: check.description }),
    })),
  examples: examples.map((example) => ({
    says: example.says,
    input: example.input ?? "",
    expect: example.expect,
  })),
});

export const hasCriteria = (packet: BlindPacket): boolean =>
  packet.examples.length > 0 || packet.criteria.some((item) => item.description !== undefined);

export interface BlindConfig {
  readonly writer: string | undefined;
  readonly maxTests: number;
}

export const blindConfig = (tree: ConfigTree): BlindConfig => {
  const writer = configAt(tree, "blind", "writer");
  const raw = configAt(tree, "blind", "max_tests");
  const max = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return {
    writer: typeof writer === "string" && writer.trim() !== "" ? writer : undefined,
    maxTests: Number.isInteger(max) && max > 0 ? Math.min(max, 20) : DEFAULT_MAX_TESTS,
  };
};

export const parseBlindTests = (text: string, max: number): readonly BlindTest[] | undefined => {
  const parsed = parseJson(text);
  const tests = parsed.ok && isRecord(parsed.value) ? parsed.value["tests"] : undefined;
  if (!Array.isArray(tests)) return undefined;
  return tests
    .flatMap((item: unknown): BlindTest[] =>
      isRecord(item) &&
      typeof item["file"] === "string" &&
      SAFE_FILE.test(item["file"]) &&
      typeof item["content"] === "string" &&
      typeof item["run"] === "string" &&
      item["run"].trim() !== ""
        ? [
            {
              name: typeof item["name"] === "string" ? item["name"] : item["file"],
              file: item["file"],
              content: item["content"],
              run: item["run"],
            },
          ]
        : [],
    )
    .slice(0, max);
};

export const commandWriter =
  (runtime: Pick<Runtime, "exec">, command: string, max: number): BlindWriter =>
  (packet, baseDir) => {
    const result = runtime.exec({
      command,
      args: [],
      cwd: baseDir,
      shell: true,
      timeoutMs: WRITER_TIMEOUT_MS,
      input: JSON.stringify(packet),
    });
    return result.found && result.exitCode === 0 ? parseBlindTests(result.stdout, max) : undefined;
  };

export interface TestRun {
  readonly passed: boolean;
  readonly output: string;
}

export const runBlindTest = (
  runtime: Pick<Runtime, "exec" | "writeText" | "mkdir" | "remove">,
  dir: AbsolutePath,
  test: BlindTest,
): TestRun => {
  const path = toAbsolutePath(join(dir, test.file));
  runtime.mkdir(toAbsolutePath(dirname(path)));
  runtime.writeText(path, test.content);
  try {
    const result = runtime.exec({
      command: test.run,
      args: [],
      cwd: dir,
      shell: true,
      timeoutMs: TEST_TIMEOUT_MS,
      env: { CI: "1" },
      unset: ["NODE_TEST_CONTEXT"],
    });
    const lines = `${result.stdout}\n${result.stderr}`.split(/\r?\n/).filter((line) => line.trim() !== "");
    return { passed: result.found && result.exitCode === 0 && !result.timedOut, output: lines.slice(-3).join(" | ") };
  } finally {
    runtime.remove(path);
  }
};
