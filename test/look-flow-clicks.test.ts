import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import type { ExecRequest } from "../src/core/runtime.js";
import { crawl, type CrawlPage } from "../src/look/flow-crawl.js";
import { approveJourney, journeyPages, journeyState, runnableJourneys } from "../src/look/journey.js";
import { type JourneyRequest, proposeFromSentence } from "../src/look/journey-propose.js";
import { fmPaths } from "../src/task/paths.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

const BASE = "http://127.0.0.1:5173";

interface FakeScreen {
  readonly links: readonly string[];
  readonly buttons: readonly (string | undefined)[];
}

const spa = (screens: Readonly<Record<string, FakeScreen>>): CrawlPage & { readonly clicks: () => number } => {
  let at = "/";
  let clicks = 0;
  return {
    visit: (route) => {
      at = route;
      return Promise.resolve();
    },
    links: () => Promise.resolve((screens[at]?.links ?? []).map((route) => `${BASE}${route}`)),
    clickables: () => Promise.resolve(screens[at]?.buttons.length ?? 0),
    click: (index) => {
      clicks += 1;
      const target = screens[at]?.buttons[index];
      if (target !== undefined) at = target;
      return Promise.resolve();
    },
    url: () => `${BASE}${at}`,
    hasBack: () => Promise.resolve(false),
    clicks: () => clicks,
  };
};

describe("flow: JavaScript navigation", () => {
  it("a button that navigates through the router adds an edge; a button that stays put adds none", async () => {
    const page = spa({
      "/": { links: ["/about"], buttons: ["/orders", undefined] },
      "/about": { links: ["/"], buttons: [] },
      "/orders": { links: [], buttons: [] },
    });
    const nodes = await crawl(page, BASE, ["/"], {});
    assert.deepEqual(
      nodes.map((node) => [node.route, node.links]),
      [
        ["/", ["/about", "/orders"]],
        ["/about", ["/"]],
        ["/orders", []],
      ],
    );
    assert.equal(page.clicks(), 2);
  });

  it("a click that leaves the app is not an edge", async () => {
    const page = spa({ "/": { links: [], buttons: [] } });
    const external: CrawlPage = { ...page, clickables: () => Promise.resolve(1), url: () => "https://example.com/x" };
    const [node] = await crawl(external, BASE, ["/"], {});
    assert.deepEqual(node?.links, []);
  });
});

const PROPOSED = {
  steps: [
    { goto: "/", expect: { text: "Home" } },
    { click: { role: "button", name: "My notes" }, expect: { url: "/notes" } },
  ],
};

describe("journeys: proposed from a sentence", () => {
  it("a journey proposed from a sentence is not run until the person approves it", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    const asked: JourneyRequest[] = [];
    const made = await proposeFromSentence(
      runtime,
      paths,
      "notes",
      { sentence: "user B opens their notes from home", routes: ["/", "/notes"] },
      (request) => {
        asked.push(request);
        return Promise.resolve({ ...PROPOSED, user: "B" });
      },
    );
    assert.ok(made.ok, JSON.stringify(made));
    assert.deepEqual(
      asked.map((item) => item.sentence),
      ["user B opens their notes from home"],
    );
    const state = journeyState(runtime, paths, "notes");
    assert.equal(state?.approved, false);
    assert.deepEqual(runnableJourneys([state]), []);
    assert.deepEqual(
      journeyPages([state], []).flatMap((page) => page.issues.map((item) => item.rule)),
      ["journey/unapproved"],
    );
    assert.ok(approveJourney(runtime, paths, "notes", undefined).ok);
    const approved = journeyState(runtime, paths, "notes");
    assert.deepEqual(
      runnableJourneys(approved === undefined ? [] : [approved]).map((journey) => [
        journey.says,
        journey.user,
        journey.steps.length,
      ]),
      [["user B opens their notes from home", "B", 2]],
    );
  });

  it("drops a proposal that is not a list of valid steps", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const runtime = repoRuntime();
    const paths = fmPaths(repo.root);
    const empty = await proposeFromSentence(runtime, paths, "bad", { sentence: "x", routes: [] }, () =>
      Promise.resolve("supported"),
    );
    assert.ok(!empty.ok);
    const noOracle = await proposeFromSentence(runtime, paths, "bad", { sentence: "x", routes: [] }, () =>
      Promise.resolve({ steps: [{ goto: "/" }] }),
    );
    assert.ok(!noOracle.ok);
    assert.equal(journeyState(runtime, paths, "bad"), undefined);
  });

  it("the command needs a configured proposer and says how to add one", async () => {
    const repo = makeRepo({ "README.md": "x\n" });
    repos.push(repo);
    const run = await cliJson(["journey", "propose", "notes", "--says", "open my notes"], {
      runtime: repoRuntime(),
      cwd: repo.root,
    });
    assert.notEqual(run.code, 0);
    assert.match(run.stdout, /journeys: proposer/);
  });

  it("the command runs the configured proposer with the sentence and leaves the journey waiting for approval", async () => {
    const repo = makeRepo({ "README.md": "x\n", ".fm/config.yml": "journeys:\n  proposer: fake-proposer\n" });
    repos.push(repo);
    const inputs: string[] = [];
    const base = repoRuntime();
    const runtime = {
      ...base,
      exec: (request: ExecRequest) => {
        if (request.command !== "fake-proposer") return base.exec(request);
        inputs.push(request.input ?? "");
        return execResult(0, JSON.stringify(PROPOSED));
      },
    };
    const run = await cliJson(["journey", "propose", "notes", "--says", "open my notes"], { runtime, cwd: repo.root });
    assert.equal(run.code, 0, run.stdout);
    assert.deepEqual(
      inputs.map((input) => field(JSON.parse(input), "sentence")),
      ["open my notes"],
    );
    assert.equal(journeyState(runtime, fmPaths(repo.root), "notes")?.approved, false);
  });
});
