import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { toPosixPath } from "../src/core/posix-path.js";
import { type HookEvent, parseHookEvent } from "../src/hooks/events.js";
import { DEFAULT_HANDLERS } from "../src/hooks/handlers.js";
import { type HookOutcome, runHook } from "../src/hooks/runner.js";
import { catalogs } from "../src/i18n/catalogs.js";
import { LANGUAGES as LANGS } from "../src/i18n/languages.js";
import { createTranslator } from "../src/i18n/translate.js";
import { COMMITTED_STATE } from "../src/install/layout.js";
import { computeIndex, thresholdsOf } from "../src/signals/loop-index.js";
import { contextLine, pasteSummary } from "../src/signals/render.js";
import { errorSignature } from "../src/signals/signature.js";
import { DEFAULT_THRESHOLD, readEntries, type SignalEntry, signalFiles } from "../src/signals/store.js";
import { fmPaths } from "../src/task/paths.js";
import { type MemoryFs, memoryFs } from "./memory-fs.js";
import { cliJson, fakeRuntime, field, parseBody, ROOT, stdinFrom } from "./support.js";

const PROJECT = toAbsolutePath("/home/ana/project");
const FIXTURES = join(ROOT, "test", "fixtures", "signals");

interface FixtureEvent {
  readonly event: HookEvent;
  readonly payload: JsonObject;
}

interface Fixture {
  readonly name: string;
  readonly expect: "loop" | "quiet";
  readonly loopedBy: string | undefined;
  readonly files: Readonly<Record<string, string>>;
  readonly events: readonly FixtureEvent[];
}

const eventsOf = (value: unknown): readonly FixtureEvent[] =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => {
        if (!isRecord(item) || typeof item["event"] !== "string" || !isRecord(item["payload"])) return [];
        const event = parseHookEvent(item["event"]);
        return event === undefined ? [] : [{ event, payload: item["payload"] }];
      })
    : [];

const loadFixture = (file: string): Fixture => {
  const parsed = parseJsonObject(readFileSync(join(FIXTURES, file), "utf8"));
  if (!parsed.ok) throw new Error(`${file}: ${parsed.error}`);
  const raw = parsed.value;
  const files = isRecord(raw["files"]) ? raw["files"] : {};
  return {
    name: file.replace(/\.json$/, ""),
    expect: raw["expect"] === "loop" ? "loop" : "quiet",
    loopedBy: typeof raw["loopedBy"] === "string" ? raw["loopedBy"] : undefined,
    files: Object.fromEntries(
      Object.entries(files).flatMap(([path, text]) => (typeof text === "string" ? [[path, text]] : [])),
    ),
    events: eventsOf(raw["events"]),
  };
};

const FIXTURE_FILES = readdirSync(FIXTURES).filter((file) => file.endsWith(".json"));

const projectFs = (files: Readonly<Record<string, string>> = {}): MemoryFs =>
  memoryFs({
    [toAbsolutePath(join(PROJECT, ".git", "HEAD"))]: "ref: refs/heads/main\n",
    [toAbsolutePath(join(PROJECT, ".finitemonkey", "config.yml"))]: "lang: en\n",
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [toAbsolutePath(join(PROJECT, path)), text])),
  });

const fire = async (fs: MemoryFs, event: HookEvent, payload: JsonObject, lang = "en" as const) => {
  const runtime = fakeRuntime({ fs });
  fs.tick(1000);
  return runHook(event, {
    stdin: stdinFrom(JSON.stringify({ hook_event_name: event, session_id: "s1", cwd: PROJECT, ...payload })),
    deadlineMs: 5000,
    handlers: DEFAULT_HANDLERS,
    cwd: PROJECT,
    t: createTranslator(lang),
    startTimer: runtime.startTimer,
    runtime,
    env: {},
  });
};

const contextOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "hookSpecificOutput", "additionalContext");
  return typeof text === "string" ? text : "";
};

const systemOf = (outcome: HookOutcome): string => {
  if (outcome.stdout.trim() === "") return "";
  const text = field(parseBody(outcome.stdout), "systemMessage");
  return typeof text === "string" ? text : "";
};

const replay = async (fixture: Fixture, fs: MemoryFs = projectFs(fixture.files)): Promise<readonly HookOutcome[]> => {
  const outcomes: HookOutcome[] = [];
  for (const step of fixture.events) outcomes.push(await fire(fs, step.event, step.payload));
  return outcomes;
};

const injected = (outcomes: readonly HookOutcome[]): readonly string[] =>
  outcomes.map(contextOf).filter((text) => text.includes("finitemonkey signals"));

describe("signals: loop fixtures fire and exploration fixtures stay quiet", () => {
  it("has loop and exploration fixtures", () => {
    const kinds = FIXTURE_FILES.map((file) => loadFixture(file).expect);
    assert.ok(kinds.filter((kind) => kind === "loop").length >= 4);
    assert.ok(kinds.filter((kind) => kind === "quiet").length >= 3);
  });

  for (const file of FIXTURE_FILES) {
    const fixture = loadFixture(file);
    it(`${fixture.name} ${fixture.expect === "loop" ? "fires" : "stays quiet"}`, async () => {
      const outcomes = await replay(fixture);
      for (const outcome of outcomes) assert.equal(outcome.verdict, "allow");
      const lines = injected(outcomes);
      if (fixture.expect === "quiet") {
        assert.deepEqual(lines, []);
        return;
      }
      assert.equal(lines.length, 1, lines.join("\n"));
      const fs = projectFs(fixture.files);
      await replay(fixture, fs);
      const index = field(
        parseBody(fs.read(toAbsolutePath(join(PROJECT, ".finitemonkey", "signals-index.json"))) ?? "{}"),
        "index",
      );
      assert.equal(field(index, "firing"), true);
      assert.equal(field(index, "loopedBy"), fixture.loopedBy);
    });
  }

  it("states the evidence in the injected line", async () => {
    const lines = injected(await replay(loadFixture("loop-same-test-error.json")));
    assert.match(lines[0] ?? "", /error signature [0-9a-f]{4} came back 3 times in this session/);
    assert.match(lines[0] ?? "", /no new request in between/);
    assert.match(lines[0] ?? "", /Frontier hypothesis: exploration/);
    const stalled = injected(await replay(loadFixture("loop-stalled-contract.json")));
    assert.match(stalled[0] ?? "", /the task contract has not moved in 4 turns/);
  });
});

describe("signals: second loop and calibration", () => {
  it("proposes /clear with a summary to paste on the second loop", async () => {
    const fixture = loadFixture("loop-same-test-error.json");
    const fs = projectFs();
    const first = await replay(fixture, fs);
    assert.equal(first.map(systemOf).filter((text) => text.includes("/clear")).length, 0);
    await fire(fs, "PostToolUseFailure", {
      tool_name: "Bash",
      error: "FAIL test/checkout.test.ts > total in cents (8 ms)\n AssertionError: expected 1202 to be 1000",
    });
    const second = await fire(fs, "UserPromptSubmit", { prompt: "Try a fourth way" });
    assert.match(systemOf(second), /second loop in this session\. A \/clear and a new request/);
    assert.match(systemOf(second), /Error [0-9a-f]{4} seen 4 times: FAIL test\/checkout\.test\.ts/);
    assert.match(systemOf(second), /Files edited: src\/checkout\.ts/);
  });

  it("a not-loop answer raises the threshold so the same repeats no longer fire", async () => {
    const fs = projectFs({ ".finitemonkey/signals-profile.json": `{"threshold":${String(DEFAULT_THRESHOLD + 1)}}` });
    assert.deepEqual(injected(await replay(loadFixture("loop-same-test-error.json"), fs)), []);
    const runtime = fakeRuntime({ fs });
    const stdin = Object.assign(stdinFrom(""), { isTTY: true });
    const recorded = await cliJson(["signals", "not-loop"], { cwd: PROJECT, runtime, stdin });
    assert.equal(recorded.code, 0);
    assert.equal(field(recorded.body, "data", "threshold"), DEFAULT_THRESHOLD + 2);
    const blocked = await cliJson(["signals", "not-loop"], { cwd: PROJECT, runtime });
    assert.notEqual(blocked.code, 0);
  });

  it("signals forget deletes the profile, the index and the log", async () => {
    const fs = projectFs({ ".finitemonkey/signals-profile.json": '{"threshold":5}' });
    await replay(loadFixture("loop-person-repeats.json"), fs);
    const runtime = fakeRuntime({ fs });
    const shown = await cliJson(["signals"], { cwd: PROJECT, runtime });
    assert.equal(field(shown.body, "data", "schema"), "finitemonkey/signals@1");
    const forgot = await cliJson(["signals", "forget"], { cwd: PROJECT, runtime });
    assert.equal(field(forgot.body, "data", "removed"), 3);
    const left = Object.keys(fs.files()).filter((path) => path.includes("signals"));
    assert.deepEqual(left, []);
  });
});

const KNOW =
  /\b(?:you|você|voce|usted|tú)\b[^.]{0,30}\b(?:don't|do not|não|no)\b[^.]{0,10}\b(?:know|sabe|sabes|entiende|entende)/i;

describe("signals: messages state observations", () => {
  it("no signals message tells the person they do not know something, in any language", () => {
    for (const lang of LANGS) {
      const catalog: Readonly<Record<string, string>> = catalogs[lang];
      for (const [key, text] of Object.entries(catalog).filter(([key]) => key.startsWith("signals."))) {
        assert.doesNotMatch(text, KNOW, `${lang} ${key}`);
        assert.doesNotMatch(text, /\byou (?:should|must|need)\b/i, `${lang} ${key}`);
      }
    }
  });

  it("the rendered line and the summary are facts with counts", () => {
    const entries: SignalEntry[] = [1, 2, 3].map((turn) => ({
      at: `2026-10-27T10:0${String(turn)}:00.000Z`,
      session: "s1",
      turn,
      kind: "error",
      sig: "e3f1",
      sample: "TypeError: x is undefined",
      tool: "Bash",
    }));
    const thresholds = thresholdsOf({ threshold: DEFAULT_THRESHOLD, notLoop: 0 });
    const index = computeIndex(entries, thresholds);
    for (const lang of LANGS) {
      const t = createTranslator(lang);
      const text = `${contextLine(t, index, thresholds)} ${pasteSummary(t, index, "t1")}`;
      assert.match(text, /e3f1/);
      assert.doesNotMatch(text, KNOW);
    }
  });
});

describe("signals: judgment and signatures", () => {
  it("a large diff approved within seconds and a later gate failure point to judgment", () => {
    const base = { session: "s1", turn: 1 };
    const entries: SignalEntry[] = [
      { ...base, at: "2026-10-27T10:00:00.000Z", kind: "approved", file: "src/a.ts", lines: 80, ms: 900, fast: true },
      ...[1, 2, 3].map((n): SignalEntry => ({
        ...base,
        at: `2026-10-27T10:0${String(n)}:30.000Z`,
        kind: "error",
        sig: "aa11",
        sample: "boom",
        tool: "Bash",
      })),
    ];
    const index = computeIndex(entries, thresholdsOf({ threshold: 3, notLoop: 0 }), "2026-10-27T10:05:00.000Z");
    assert.equal(index.frontier, "judgment");
    assert.equal(index.fastAccepts, 1);
    assert.equal(index.caughtAfterApproval, 1);
  });

  it("records a fast approval between PermissionRequest and PostToolUse", async () => {
    const fs = projectFs();
    const content = Array.from({ length: 40 }, (_, line) => `export const v${String(line)} = ${String(line)};`).join(
      "\n",
    );
    const input = { file_path: join(PROJECT, "src", "big.ts"), content };
    await fire(fs, "PermissionRequest", { tool_name: "Write", tool_input: input });
    await fire(fs, "PostToolUse", { tool_name: "Write", tool_input: input, tool_response: { success: true } });
    const entries = readEntries(fakeRuntime({ fs }), signalFiles(fmPaths(PROJECT)));
    const approved = entries.find((entry) => entry.kind === "approved");
    assert.equal(approved?.kind === "approved" ? approved.fast : undefined, true);
  });

  it("the same error with other numbers, paths and durations has the same signature", () => {
    const one = errorSignature("FAIL /home/ana/p/test/a.test.ts (12 ms)\nAssertionError: expected 3 to be 4");
    const two = errorSignature("FAIL C:\\Users\\ana\\p\\test\\a.test.ts (7 ms)\nAssertionError: expected 5 to be 4");
    const other = errorSignature("TypeError: cannot read properties of undefined (reading 'id')");
    assert.equal(one?.sig, two?.sig);
    assert.notEqual(one?.sig, other?.sig);
  });
});

describe("signals: all data stays local", () => {
  it("writes only ignored files under .finitemonkey, never the prompt text, and calls nothing", async () => {
    const fs = projectFs();
    const before = new Set(Object.keys(fs.files()));
    const calls: string[] = [];
    const runtime = fakeRuntime({
      fs,
      exec: (request) => {
        calls.push(request.command);
        return undefined;
      },
    });
    for (const step of loadFixture("loop-person-repeats.json").events) {
      fs.tick(1000);
      await runHook(step.event, {
        stdin: stdinFrom(
          JSON.stringify({ hook_event_name: step.event, session_id: "s1", cwd: PROJECT, ...step.payload }),
        ),
        deadlineMs: 5000,
        handlers: DEFAULT_HANDLERS,
        cwd: PROJECT,
        t: createTranslator("en"),
        startTimer: runtime.startTimer,
        runtime,
        env: {},
      });
    }
    assert.deepEqual(calls, []);
    const written = Object.keys(fs.files()).filter((path) => !before.has(path));
    const prefix = `${toPosixPath(PROJECT)}/.finitemonkey/`;
    for (const path of written) {
      assert.ok(toPosixPath(path).startsWith(prefix), path);
      const local = toPosixPath(path).slice(prefix.length);
      assert.ok(!COMMITTED_STATE.some((kept) => local.startsWith(kept)), local);
    }
    const log = fs.read(toAbsolutePath(join(PROJECT, ".finitemonkey", "signals.jsonl"))) ?? "";
    assert.ok(log.length > 0);
    assert.doesNotMatch(log, /work on mobile|make the|please/i);
  });
});
