import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { withOnboardStart } from "../src/app/onboard-start.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { discoverStart } from "../src/onboard/discover.js";
import { onboardText, parseOnboard } from "../src/onboard/state.js";
import type { ProjectFiles } from "../src/task/implicit.js";
import { fmPaths } from "../src/task/paths.js";
import type { AcceptanceCheck } from "../src/task/types.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath(join("/home", "ana", "app"));
const at = (file: string): string => join(ROOT, file);

const filesOf = (files: Readonly<Record<string, string>>): ProjectFiles => ({
  read: (path) => files[path],
  exists: (path) => files[path] !== undefined,
});

const RUNTIME_CHECK: AcceptanceCheck = { id: "app", kind: "runtime", port: 3000 };

describe("onboarding records the start command and the runtime check uses it", () => {
  it("finds dev, then start, then serve, with the project's package manager", () => {
    const pkg = (scripts: Record<string, string>) => JSON.stringify({ scripts });
    assert.equal(discoverStart(filesOf({ "package.json": pkg({ dev: "vite", start: "node s.js" }) })), "npm run dev");
    assert.equal(
      discoverStart(filesOf({ "package.json": pkg({ start: "node s.js" }), "pnpm-lock.yaml": "" })),
      "pnpm run start",
    );
    assert.equal(discoverStart(filesOf({ "package.json": pkg({ test: "vitest" }) })), undefined);
  });

  it("the record keeps the start command across a write and a read", () => {
    const state = { commands: [], historyFindings: 0, start: "npm run dev" };
    assert.equal(parseOnboard(onboardText(state))?.start, "npm run dev");
    assert.equal(parseOnboard(onboardText({ commands: [], historyFindings: 0 }))?.start, undefined);
  });

  const record = onboardText({ commands: [], historyFindings: 0, start: "npm run dev" });

  it("when active, a runtime check without run starts the app from the record", () => {
    const runtime = fakeRuntime({
      files: {
        [at(".fm/onboard.json")]: record,
        [at(".fm/policy.yml")]: "guards:\n  onboard-start: active\n",
      },
    });
    assert.equal(withOnboardStart(runtime, fmPaths(ROOT), RUNTIME_CHECK).run, "npm run dev");
    const declared = { ...RUNTIME_CHECK, run: "node server.js" };
    assert.equal(withOnboardStart(runtime, fmPaths(ROOT), declared).run, "node server.js");
  });

  it("in shadow, the default, the check stays as declared", () => {
    const runtime = fakeRuntime({ files: { [at(".fm/onboard.json")]: record } });
    assert.equal(withOnboardStart(runtime, fmPaths(ROOT), RUNTIME_CHECK).run, undefined);
  });
});
