import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { after, describe, it } from "node:test";

import type { TextSource } from "../src/core/context.js";
import type { ExecRequest, Runtime } from "../src/core/runtime.js";
import { inventoryOf } from "../src/infra/scan.js";
import { INFRA_PATTERNS, INFRA_RISKS, type InfraPattern, type InfraRisk } from "../src/infra/types.js";
import { makeRepo, type Repo, repoRuntime } from "./repo.js";
import { cli, cliJson, execResult, field } from "./support.js";

const repos: Repo[] = [];
after(() => {
  for (const repo of repos) repo.cleanup();
});

type Files = Readonly<Record<string, string>>;

const WORKFLOW_SSH = [
  "name: deploy",
  "on:",
  "  push:",
  "    branches: [main]",
  "jobs:",
  "  deploy:",
  "    runs-on: ubuntu-latest",
  "    steps:",
  "      - run: |",
  "          ssh -o StrictHostKeyChecking=no deploy@203.0.113.7 'cd /srv/app && git pull && npm run build && pm2 restart app'",
  "",
].join("\n");

const PATTERN_FIXTURES: Readonly<Record<InfraPattern, Files>> = {
  vercel: { "vercel.json": "{}\n" },
  netlify: { "netlify.toml": "[build]\n" },
  fly: { "fly.toml": "app = 'shop'\n" },
  render: { "render.yaml": "services: []\n" },
  railway: { "railway.json": "{}\n" },
  heroku: { Procfile: "web: node server.js\n" },
  cloudflare: { "wrangler.toml": "name = 'shop'\n" },
  "github-pages": { ".github/workflows/pages.yml": "jobs:\n  d:\n    steps:\n      - uses: actions/deploy-pages@v4\n" },
  dockerfile: { Dockerfile: "FROM node:22\nUSER node\n" },
  compose: { "compose.yml": "services:\n  web:\n    image: shop@sha256:abc\n" },
  terraform: { "infra/main.tf": 'resource "x" "y" {}\n' },
  pulumi: { "Pulumi.yaml": "name: shop\n" },
  cdk: { "cdk.json": "{}\n" },
  serverless: { "serverless.yml": "service: shop\n" },
  kubernetes: { "k8s/web.yaml": "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\n" },
  helm: { "chart/Chart.yaml": "name: shop\n" },
  kustomize: { "k8s/kustomization.yaml": "resources: []\n" },
  pm2: { "ecosystem.config.js": "module.exports = { apps: [] };\n" },
  systemd: { "deploy/shop.service": "[Unit]\n[Service]\nExecStart=/usr/bin/node app.js\n" },
  nginx: { "deploy/nginx.conf": "server { listen 80; }\n" },
  caddy: { Caddyfile: "shop.example.com {\n  reverse_proxy :3000\n}\n" },
  "ssh-deploy": { ".github/workflows/deploy.yml": WORKFLOW_SSH },
  "deploy-script": { "scripts/deploy.sh": "#!/bin/sh\necho deploy\n" },
  migrations: { "prisma/migrations/001_init/migration.sql": "CREATE TABLE a (id int);\n" },
  sentry: { "package.json": '{ "dependencies": { "@sentry/node": "^9.0.0" } }\n' },
  opentelemetry: { "package.json": '{ "dependencies": { "@opentelemetry/api": "^1.9.0" } }\n' },
  "json-logger": { "package.json": '{ "dependencies": { "pino": "^9.0.0" } }\n' },
  apm: { "package.json": '{ "dependencies": { "dd-trace": "^5.0.0" } }\n' },
  "health-route": { "app/api/health/route.ts": "export const GET = () => new Response('ok');\n" },
};

const RISK_FIXTURES: Readonly<Record<InfraRisk, Files>> = {
  "git-pull-on-server": { ".github/workflows/deploy.yml": WORKFLOW_SSH },
  "build-on-server": { ".github/workflows/deploy.yml": WORKFLOW_SSH },
  "deploy-without-ci": { ".github/workflows/deploy.yml": WORKFLOW_SSH },
  "host-key-unchecked": { ".github/workflows/deploy.yml": WORKFLOW_SSH },
  "mutable-image-tag": { "docker-compose.yml": "services:\n  web:\n    image: shop:latest\n" },
  "root-container": { Dockerfile: "FROM node:22\nCMD node app.js\n" },
  "host-in-repo": { "scripts/deploy.sh": "#!/bin/sh\nssh deploy@shop.example.com 'docker compose pull'\n" },
};

const inventory = (files: Files) =>
  inventoryOf(
    Object.entries(files).map(([path, text]) => ({ path, text })),
    Object.keys(files),
  );

describe("infra inventory", () => {
  for (const pattern of INFRA_PATTERNS) {
    it(`detects ${pattern} from its fixture`, () => {
      const hits = inventory(PATTERN_FIXTURES[pattern]).hits.map((hit) => hit.pattern);
      assert.ok(hits.includes(pattern), `${pattern} not in ${hits.join(", ")}`);
    });
  }

  for (const id of INFRA_RISKS) {
    it(`reports ${id} with file and line`, () => {
      const risk = inventory(RISK_FIXTURES[id]).risks.find((item) => item.id === id);
      assert.ok(risk !== undefined, id);
      assert.ok(risk.line >= 1);
      assert.ok(Object.keys(RISK_FIXTURES[id]).includes(risk.file));
    });
  }

  it("a hardened setup has no risk", () => {
    const found = inventory({
      Dockerfile: "FROM node:22\nUSER node\n",
      "compose.yml": "services:\n  web:\n    image: ghcr.io/acme/shop@sha256:abc\n",
    });
    assert.deepEqual(found.risks, []);
  });

  it("levels: static is 0, one server is 1, IaC is 2, Kubernetes is 3", () => {
    assert.equal(inventory(PATTERN_FIXTURES.netlify).level, 0);
    assert.equal(inventory(PATTERN_FIXTURES["ssh-deploy"]).level, 1);
    assert.equal(inventory(PATTERN_FIXTURES.terraform).level, 2);
    assert.equal(inventory(PATTERN_FIXTURES.kubernetes).level, 3);
  });

  it("describes the ssh target and flags conflicting signals", () => {
    const found = inventory({ ...PATTERN_FIXTURES["ssh-deploy"], ...PATTERN_FIXTURES.vercel });
    const ssh = found.targets.find((target) => target.type === "ssh");
    assert.equal(ssh?.trigger, "push");
    assert.equal(ssh.buildLocation, "server");
    assert.equal(ssh.artifact, "source");
    assert.equal(ssh.waitsForCi, "no");
    assert.deepEqual(ssh.hosts, ["prod-1"]);
    assert.equal(found.conflicts.length, 1);
  });
});

const IGNORE = ".finitemonkey/*\n!.finitemonkey/config.yml\n!.finitemonkey/infra.yml\n";

const project = (files: Files): Repo => {
  const repo = makeRepo({ ".gitignore": IGNORE, ".finitemonkey/config.yml": "lang: en\n", ...files });
  repos.push(repo);
  return repo;
};

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const sshRecorder = (): { readonly calls: ExecRequest[]; readonly runtime: Runtime } => {
  const calls: ExecRequest[] = [];
  const base = repoRuntime();
  return {
    calls,
    runtime: {
      ...base,
      exec: (request) => {
        if (request.command !== "ssh") return base.exec(request);
        calls.push(request);
        return execResult(0, "web ghcr.io/acme/shop@sha256:abc\n");
      },
    },
  };
};

describe("finitemonkey infra", () => {
  it("writes no host or IP to the versioned file and keeps them in hosts.local.yml", async () => {
    const repo = project({
      ".github/workflows/deploy.yml": WORKFLOW_SSH,
      "scripts/deploy.sh": "#!/bin/sh\nssh ops@shop.example.com 'docker compose pull'\n",
    });
    const run = await cliJson(["infra"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0, run.stdout);
    const infra = repo.read(".finitemonkey/infra.yml");
    for (const secret of ["203.0.113.7", "shop.example.com", "deploy@", "ops@"]) {
      assert.ok(!infra.includes(secret), `${secret} leaked into infra.yml`);
      assert.ok(!run.stdout.includes(secret), `${secret} leaked into the output`);
    }
    const hosts = repo.read(".finitemonkey/hosts.local.yml");
    assert.match(hosts, /203\.0\.113\.7/);
    assert.match(hosts, /shop\.example\.com/);
    assert.equal(repo.git("status", "--porcelain", "--", ".finitemonkey/hosts.local.yml").trim(), "");
    assert.match(repo.git("status", "--porcelain", "--", ".finitemonkey/infra.yml"), /infra\.yml/);
  });

  it("refuses to write addresses when git would track them", async () => {
    const repo = makeRepo({ ".github/workflows/deploy.yml": WORKFLOW_SSH });
    repos.push(repo);
    const run = await cli(["infra"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(run.code, 0);
    assert.match(run.stdout, /not ignored by git/);
    assert.throws(() => repo.read(".finitemonkey/hosts.local.yml"));
  });

  it("shows a diff and keeps the file when it changed, until --yes", async () => {
    const repo = project({ "fly.toml": "app = 'shop'\n" });
    await cli(["infra"], { cwd: repo.root, runtime: repoRuntime() });
    repo.write("Dockerfile", "FROM node:22\n");
    const before = repo.read(".finitemonkey/infra.yml");
    const pending = await cliJson(["infra"], { cwd: repo.root, runtime: repoRuntime() });
    assert.equal(field(pending.body, "data", "infraFile"), "pending");
    assert.equal(pending.body["next"], "finitemonkey infra --yes");
    assert.equal(repo.read(".finitemonkey/infra.yml"), before);
    await cli(["infra", "--yes"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(repo.read(".finitemonkey/infra.yml"), /root-container/);
  });

  it("--remote needs the person's yes in a terminal; an agent cannot start it", async () => {
    const repo = project({ ".github/workflows/deploy.yml": WORKFLOW_SSH });
    const fakes = sshRecorder();
    const attempts = [
      { argv: ["infra", "--remote"], env: {}, stdin: tty() },
      { argv: ["infra", "--remote", "--yes"], env: {}, stdin: Readable.from([]) },
      { argv: ["infra", "--remote", "--yes"], env: { CLAUDECODE: "1" }, stdin: tty() },
    ];
    for (const attempt of attempts) {
      const run = await cli(attempt.argv, {
        cwd: repo.root,
        runtime: fakes.runtime,
        env: attempt.env,
        stdin: attempt.stdin,
      });
      assert.equal(run.code, 4, attempt.argv.join(" "));
    }
    assert.equal(fakes.calls.length, 0);
    const run = await cli(["infra", "--remote", "--yes"], { cwd: repo.root, runtime: fakes.runtime, stdin: tty() });
    assert.equal(run.code, 0, run.stdout);
    assert.notEqual(fakes.calls.length, 0);
    assert.ok(fakes.calls.every((call) => call.args.includes("BatchMode=yes")));
    assert.match(run.stdout, /prod-1: 1 container/);
  });

  it("does nothing when policy turns it off", async () => {
    const repo = project({ ".finitemonkey/policy.yml": "guards:\n  infra: off\n", "fly.toml": "app = 'x'\n" });
    const run = await cli(["infra"], { cwd: repo.root, runtime: repoRuntime() });
    assert.match(run.stdout, /off/);
    assert.throws(() => repo.read(".finitemonkey/infra.yml"));
  });
});
