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
    describes: "`data` of `finitemonkey doctor --json`.",
  },
  {
    name: "gate@1",
    file: "src/gate/report.ts",
    type: "GateReport",
    describes: "`data` of `finitemonkey gate --json`.",
  },
  {
    name: "gain@1",
    file: "src/gain/gain.ts",
    type: "GainReport",
    describes: "`data` of `finitemonkey gain --json`.",
  },
  {
    name: "merge-verify@1",
    file: "src/git/merge/verify.ts",
    type: "VerifyReport",
    describes: "Report of one merge checked by `finitemonkey merge verify`.",
  },
  {
    name: "secrets-scan@1",
    file: "src/commands/secrets-scan.ts",
    type: "SecretsScanData",
    describes: "`data` of `finitemonkey secrets scan --json`.",
  },
  {
    name: "deps-check@1",
    file: "src/commands/deps-check.ts",
    type: "DepsCheckData",
    describes: "`data` of `finitemonkey deps check --json`.",
  },
  {
    name: "deps-scan@1",
    file: "src/commands/deps-scan.ts",
    type: "DepsScanData",
    describes: "`data` of `finitemonkey deps scan --json`.",
  },
  {
    name: "prose-check@1",
    file: "src/commands/prose-view.ts",
    type: "ProseCheckData",
    describes: "`data` of `finitemonkey prose check --json`.",
  },
  {
    name: "app-check@1",
    file: "src/commands/app-check.ts",
    type: "AppCheckData",
    describes: "`data` of `finitemonkey app check --json`.",
  },
  {
    name: "look@1",
    file: "src/commands/look.ts",
    type: "LookData",
    describes: "`data` of `finitemonkey look --json`.",
  },
  {
    name: "uninstall-plan@1",
    file: "src/commands/uninstall.ts",
    type: "UninstallData",
    describes: "`data` of `finitemonkey uninstall --json`.",
  },
  {
    name: "wt-list@1",
    file: "src/commands/wt-list.ts",
    type: "WtListData",
    describes: "`data` of `finitemonkey wt list --json`.",
  },
  {
    name: "merge-report@1",
    file: "src/merge/report.ts",
    type: "MergeReport",
    describes: "Report of one merge run by `finitemonkey merge`, also `data` of its `--json` output.",
  },
  {
    name: "front-report@1",
    file: "src/fronts/report.ts",
    type: "FrontReport",
    describes:
      "`.finitemonkey/reports/<front>.json`, written by a front before it stops and checked by the front-report gate.",
  },
  {
    name: "coverage@1",
    file: "src/testbudget/budget.ts",
    type: "CoverageFile",
    describes:
      "The per-test coverage file named by `test_budget.coverage` in `.finitemonkey/config.yml`: for each test id, the lines it runs and the assertions it makes, read by the test-budget check to find redundant tests.",
  },
  {
    name: "evidence@1",
    file: "src/evidence/types.ts",
    type: "Evidence",
    describes: "One line of `.finitemonkey/evidence/<task>.jsonl`.",
  },
  {
    name: "policy-explain@1",
    file: "src/policy/explain.ts",
    type: "PolicyExplainData",
    describes: "`data` of `finitemonkey policy explain --json`.",
  },
  {
    name: "blind-band@1",
    file: "src/commands/signals-blind-band.ts",
    type: "BlindBandData",
    describes: "`data` of `finitemonkey signals blind-band --json`.",
  },
  {
    name: "blind-band@2",
    file: "src/commands/signals-blind-band.ts",
    type: "OpenBlindBandData",
    describes: "`data` of `finitemonkey signals blind-band --fields --json`: rows keyed by any top-level field.",
  },
  {
    name: "guardian-status@1",
    file: "src/guardian/status.ts",
    type: "GuardianStatus",
    describes: "`data` of `finitemonkey guardian status --json`.",
  },
  {
    name: "status@1",
    file: "src/bridge/status.ts",
    type: "StatusData",
    describes: "`data` of `finitemonkey status --json`, which the mod draws in the band and the gate pane.",
  },
  {
    name: "judge@1",
    file: "src/judge/types.ts",
    type: "JudgeExport",
    describes:
      "The judge data model: every entry of `.finitemonkey/judge.jsonl` by type, also `export` in `finitemonkey judge export --json`.",
  },
  {
    name: "judge-verbs@1",
    file: "src/judge/response.ts",
    type: "JudgeResponse",
    describes:
      "`data` of every `finitemonkey judge <verb> --json` and of `judge call`: the same JSON for the CLI, the mod pane, the skill and the gate.",
  },
  {
    name: "stale@1",
    file: "src/stale/report.ts",
    type: "StaleReport",
    describes: "`data` of `finitemonkey stale --json`: doc lines whose status the code no longer backs.",
  },
  {
    name: "recap@1",
    file: "src/recap/recap.ts",
    type: "RecapReport",
    describes: "`data` of `finitemonkey recap --json`: what was done in a period, built from the ledger and git.",
  },
];
