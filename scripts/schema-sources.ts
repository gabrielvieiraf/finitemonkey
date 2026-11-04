export interface SchemaSource {
  readonly name: string;
  readonly file: string;
  readonly type: string;
  readonly describes: string;
}

export const SCHEMA_SOURCES: readonly SchemaSource[] = [
  {
    name: "envelope@1",
    file: "src/core/result.ts",
    type: "Envelope",
    describes: "Every `--json` output: the envelope around the command data.",
  },
  {
    name: "doctor@1",
    file: "src/commands/doctor.ts",
    type: "DoctorData",
    describes: "`data` of `fm doctor --json`.",
  },
  {
    name: "gate@1",
    file: "src/gate/report.ts",
    type: "GateReport",
    describes: "`data` of `fm gate --json`.",
  },
  {
    name: "gain@1",
    file: "src/gain/gain.ts",
    type: "GainReport",
    describes: "`data` of `fm gain --json`.",
  },
  {
    name: "merge-verify@1",
    file: "src/git/merge/verify.ts",
    type: "VerifyReport",
    describes: "Report of one merge checked by `fm merge verify`.",
  },
  {
    name: "secrets-scan@1",
    file: "src/commands/secrets-scan.ts",
    type: "SecretsScanData",
    describes: "`data` of `fm secrets scan --json`.",
  },
  {
    name: "deps-check@1",
    file: "src/commands/deps-check.ts",
    type: "DepsCheckData",
    describes: "`data` of `fm deps check --json`.",
  },
  {
    name: "deps-scan@1",
    file: "src/commands/deps-scan.ts",
    type: "DepsScanData",
    describes: "`data` of `fm deps scan --json`.",
  },
  {
    name: "prose-check@1",
    file: "src/commands/prose-view.ts",
    type: "ProseCheckData",
    describes: "`data` of `fm prose check --json`.",
  },
  {
    name: "app-check@1",
    file: "src/commands/app-check.ts",
    type: "AppCheckData",
    describes: "`data` of `fm app check --json`.",
  },
  {
    name: "look@1",
    file: "src/commands/look.ts",
    type: "LookData",
    describes: "`data` of `fm look --json`.",
  },
  {
    name: "uninstall-plan@1",
    file: "src/commands/uninstall.ts",
    type: "UninstallData",
    describes: "`data` of `fm uninstall --json`.",
  },
  {
    name: "wt-list@1",
    file: "src/commands/wt-list.ts",
    type: "WtListData",
    describes: "`data` of `fm wt list --json`.",
  },
  {
    name: "merge-report@1",
    file: "src/merge/report.ts",
    type: "MergeReport",
    describes: "Report of one merge run by `fm merge`, also `data` of its `--json` output.",
  },
  {
    name: "front-report@1",
    file: "src/fronts/report.ts",
    type: "FrontReport",
    describes: "`.fm/reports/<front>.json`, written by a front before it stops and checked by the front-report gate.",
  },
  {
    name: "coverage@1",
    file: "src/testbudget/budget.ts",
    type: "CoverageFile",
    describes:
      "The per-test coverage file named by `test_budget.coverage` in `.fm/config.yml`: for each test id, the lines it runs and the assertions it makes, read by the test-budget check to find redundant tests.",
  },
  {
    name: "evidence@1",
    file: "src/evidence/types.ts",
    type: "Evidence",
    describes: "One line of `.fm/evidence/<task>.jsonl`.",
  },
  {
    name: "policy-explain@1",
    file: "src/policy/explain.ts",
    type: "PolicyExplainData",
    describes: "`data` of `fm policy explain --json`.",
  },
  {
    name: "blind-band@1",
    file: "src/commands/signals-blind-band.ts",
    type: "BlindBandData",
    describes: "`data` of `fm signals blind-band --json`.",
  },
  {
    name: "blind-band@2",
    file: "src/commands/signals-blind-band.ts",
    type: "OpenBlindBandData",
    describes: "`data` of `fm signals blind-band --fields --json`: rows keyed by any top-level field.",
  },
  {
    name: "guardian-status@1",
    file: "src/guardian/status.ts",
    type: "GuardianStatus",
    describes: "`data` of `fm guardian status --json`.",
  },
  {
    name: "status@1",
    file: "src/bridge/status.ts",
    type: "StatusData",
    describes: "`data` of `fm status --json`, which the mod draws in the band and the gate pane.",
  },
  {
    name: "judge@1",
    file: "src/judge/types.ts",
    type: "JudgeExport",
    describes:
      "The judge data model: every entry of `.fm/judge.jsonl` by type, also `export` in `fm judge export --json`.",
  },
  {
    name: "judge-verbs@1",
    file: "src/judge/response.ts",
    type: "JudgeResponse",
    describes:
      "`data` of every `fm judge <verb> --json` and of `judge call`: the same JSON for the CLI, the mod pane, the skill and the gate.",
  },
  {
    name: "stale@1",
    file: "src/stale/report.ts",
    type: "StaleReport",
    describes: "`data` of `fm stale --json`: doc lines whose status the code no longer backs.",
  },
  {
    name: "recap@1",
    file: "src/recap/recap.ts",
    type: "RecapReport",
    describes: "`data` of `fm recap --json`: what was done in a period, built from the ledger and git.",
  },
];
