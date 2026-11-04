export const MOD_LABELS_EN = {
  "mod.view.band_button": "gate panel",
  "mod.view.no_contract": "no contract",
  "mod.view.contract_full": "contract {id} {hash}",
  "mod.view.not_verified_title": "not verified:",
  "mod.view.run_gate": "Run gate",
  "mod.view.close": "Close",
  "mod.view.no_cost": "no cost recorded for this contract",
  "mod.view.triage": "triage {open}/{flagged} open",
  "mod.view.trajectory": "trajectory {domain}{spark}: {band}",
  "mod.view.no_accepted_work": "no accepted work",
  "mod.view.no_ricochet": "no ricochet",
  "mod.view.last_ricochet": "last ricochet {concept} {week}",
  "mod.view.knowledge_rules":
    "{count, plural, one {# rule in AGENTS.md/CLAUDE.md does} other {# rules in AGENTS.md/CLAUDE.md do}} not match the code (finitemonkey instructions)",
  "mod.view.knowledge_stale":
    "{count, plural, one {# recorded fact points} other {# recorded facts point}} at code that changed (finitemonkey claims list)",
  "mod.view.knowledge_quarantined":
    "{count, plural, one {# recorded fact waits} other {# recorded facts wait}} for a green gate or your approval (finitemonkey claims list)",
  "mod.view.blind": "blind band {domain} {index} {spark} ({without}/{helps} help without criterion)",
  "mod.view.bypassed": "⚠ {count, plural, one {# guard} other {# guards}} bypassed",
  "mod.view.gate": "gate {mark} {passed}/{total}",
  "mod.view.gate_mark": "gate {mark}",
  "mod.view.not_verified_count": "{count} not verified",
  "mod.view.contract_short": "contract {hash}",
  "mod.view.evidence_old": "evidence {count, plural, one {# edit} other {# edits}} old",
  "mod.view.loop":
    "same error back {count, plural, one {# time} other {# times}}, research due at try {limit} (finitemonkey signals)",
  "mod.view.loop_held":
    "same error back {count, plural, one {# time} other {# times}}: research before the next edit (finitemonkey signals)",
  "mod.view.cost_usd": "{usd} this contract",
  "mod.view.cost_tokens": "{tokens} tokens this contract",
  "mod.view.xray": "x-ray {count} beyond the record without criterion",
  "mod.view.criteria_without_check": "{count, plural, one {# criterion} other {# criteria}} without check",
  "mod.view.stale": "(stale)",
  "mod.view.cost_contract_usd": "contract {task}: {usd} in {requests, plural, one {# request} other {# requests}}",
  "mod.view.cost_contract_tokens":
    "contract {task}: {tokens} tokens in {requests, plural, one {# request} other {# requests}}",
  "mod.view.cost_token_split": "input {input} · output {output} · cache read {cacheRead} · cache write {cacheWrite}",
  "mod.view.attempts": "attempts {attempts} · per attempt {perAttempt}",
  "mod.view.split": "build {build} · verification {verification} + gate {minutes} min",
  "mod.view.arm": "arm {arm}: {usd} in {requests, plural, one {# request} other {# requests}}",
  "mod.view.command_description": "Finite Monkey: gate state, contract and what is not verified",
  "mod.view.command_taken": "finitemonkey: /fm is taken by another command; the gate panel opens from the band",
  "mod.view.loading": "finitemonkey: reading the gate…",
  "mod.view.cost_title": "Finite Monkey · cost",
  "mod.view.fronts_title": "Finite Monkey · fronts",
  "mod.view.no_worktrees": "finitemonkey: no worktrees found",
  "mod.view.no_handoff": "finitemonkey: no handoff in this folder",
  "mod.view.no_status": "finitemonkey: no gate status in this folder",
} as const;

export type ModLabelKey = keyof typeof MOD_LABELS_EN;

export const MOD_LABELS_SCHEMA = "finitemonkey/mod-labels@1";
