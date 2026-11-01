import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { manualTrajectoryFiles } from "../scripts/manual-trajectory-lib.js";
import { readConceptEvents } from "../src/conceitos/evidence.js";
import { trajectories, TRAJECTORY_FEATURE } from "../src/conceitos/trajectory.js";
import { helpMarks, trajectoryNowOf } from "../src/conceitos/trajectory-now.js";
import { toAbsolutePath } from "../src/core/brand.js";
import { featureMode } from "../src/policy/feature.js";
import { blindBand } from "../src/signals/blind-band.js";
import { fmPaths } from "../src/task/paths.js";
import { memoryFs } from "./memory-fs.js";
import { fakeRuntime } from "./support.js";

const ROOT = toAbsolutePath(join("/home", "ana", "manual-trajectory"));
const NOWS = ["2026-11-01T12:00:00.000Z", "2026-11-02T00:00:05.000Z", "2026-12-31T23:59:59.000Z"];

const seeded = (now: string) => {
  const files = manualTrajectoryFiles(Date.parse(now));
  const fs = memoryFs(
    Object.fromEntries(Object.entries(files).map(([path, text]) => [toAbsolutePath(join(ROOT, path)), text])),
    [toAbsolutePath(join(ROOT, ".git"))],
    now,
  );
  return { runtime: fakeRuntime({ fs }), paths: fmPaths(ROOT) };
};

describe("manual trajectory fixture", () => {
  for (const now of NOWS) {
    it(`draws a ricochet and a held mark in separate weeks at ${now}`, () => {
      const { runtime, paths } = seeded(now);
      const log = runtime.readText(paths.log);
      assert.ok(log.ok);
      const all = trajectories(readConceptEvents(runtime, paths), helpMarks(log.value), Date.parse(now));
      const backend = all.find((item) => item.domain === "backend");
      assert.ok(backend);
      assert.equal(backend.status, "ok");
      const { marks } = backend;
      assert.deepEqual(
        marks.map((mark) => [mark.kind, mark.concept]),
        [
          ["ricochet", "webhook"],
          ["held", "idempotency"],
        ],
      );
      assert.notEqual(marks[0]?.week, marks[1]?.week);
      assert.ok(backend.weeks.some((week) => week.assisted === null));
      assert.equal(all.find((item) => item.domain === "infrastructure")?.status, "no_data");
    });
  }

  it("turns the trajectory on and feeds the band segment and the blind band", () => {
    const { runtime, paths } = seeded(NOWS[0] ?? "");
    assert.equal(featureMode(runtime, paths, TRAJECTORY_FEATURE), "active");
    assert.equal(trajectoryNowOf(runtime, paths)?.ricochet?.concept, "webhook");
    const log = runtime.readText(paths.log);
    assert.ok(log.ok);
    assert.ok(blindBand(runtime, paths, log.value).rows.some((row) => row.withoutCriterion > 0));
  });
});
