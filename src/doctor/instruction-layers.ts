import { type InstructionFinding, instructionFindings } from "../instructions/findings.js";
import { resolveInstructions } from "../instructions/resolve.js";
import { type Check, type CheckFinding, finding } from "./types.js";

const COVERED_ELSEWHERE = new Set(["AGENTS.md", "CLAUDE.md"]);

type Of<K extends InstructionFinding["kind"]> = Extract<InstructionFinding, { readonly kind: K }>;

const only = <K extends InstructionFinding["kind"]>(list: readonly InstructionFinding[], kind: K): readonly Of<K>[] =>
  list.filter((item): item is Of<K> => item.kind === kind);

const at = (ref: { readonly file: string; readonly line: number }): string => `${ref.file}:${String(ref.line)}`;

const pairFinding = (
  check: string,
  key: "doctor.instructions.layers_conflict" | "doctor.instructions.layers_duplicate",
  fix: "doctor.instructions.fix_layers_conflict" | "doctor.instructions.fix_layers_duplicate",
  list: readonly Of<"conflict" | "duplicate">[],
): readonly CheckFinding[] => {
  const first = list[0];
  if (first === undefined) return [];
  return [finding(check, "warn", key, { count: list.length, first: at(first.first), second: at(first.second) }, fix)];
};

const volatileFinding = (volatile: readonly Of<"volatile">[]): readonly CheckFinding[] =>
  volatile.length === 0
    ? []
    : [
        finding(
          "instructions.volatile",
          "warn",
          "doctor.instructions.volatile",
          { count: volatile.length, files: [...new Set(volatile.map((item) => item.at.file))].join(", ") },
          "doctor.instructions.fix_volatile",
        ),
      ];

const singleFindings = (found: readonly InstructionFinding[]): readonly CheckFinding[] => [
  ...only(found, "shadowed").map((item) =>
    finding(
      "instructions.shadowed",
      "warn",
      "doctor.instructions.shadowed",
      { file: item.file, by: item.by },
      "doctor.instructions.fix_shadowed",
    ),
  ),
  ...only(found, "oversized")
    .filter((item) => !COVERED_ELSEWHERE.has(item.file))
    .map((item) =>
      finding(
        "instructions.size",
        "warn",
        "doctor.instructions.size",
        { file: item.file, lines: item.lines, max: item.max },
        "doctor.instructions.fix_size",
      ),
    ),
];

export const checkInstructionLayers: Check = (env) => {
  const found = instructionFindings(
    resolveInstructions({
      runtime: env.runtime,
      root: env.root,
      cwd: env.cwd,
      home: env.runtime.homeDir(),
      platform: env.platform,
    }),
  );
  return [
    ...pairFinding(
      "instructions.layers_conflict",
      "doctor.instructions.layers_conflict",
      "doctor.instructions.fix_layers_conflict",
      only(found, "conflict"),
    ),
    ...pairFinding(
      "instructions.layers_duplicate",
      "doctor.instructions.layers_duplicate",
      "doctor.instructions.fix_layers_duplicate",
      only(found, "duplicate"),
    ),
    ...volatileFinding(only(found, "volatile")),
    ...singleFindings(found),
  ];
};
