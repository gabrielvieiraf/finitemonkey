import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { gitPreToolUse } from "../src/git/hooks/pre-tool.js";
import { EVIDENCE_FILE } from "../src/prod/guard.js";
import { bash, hook, reasonOf, type TempRepo, tempRepo } from "./git-support.js";

const CONFIG = `prod:
  hosts:
    - app.example.com
  kube_contexts: [live-eu]
`;

const WORKFLOW = `name: deploy
on: push
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - run: ssh deploy@203.0.113.7 'cd /opt/app && docker compose pull && docker compose up -d'
`;

const BLOCKED: readonly string[] = [
  "ssh app.example.com 'docker compose up -d'",
  "ssh deploy@app.example.com sudo systemctl restart app",
  "ssh 203.0.113.7 'rm -rf /opt/app/releases/old'",
  "ssh root@203.0.113.7",
  "ssh -p 2222 app.example.com 'echo x > /etc/app.conf'",
  "scp .env app.example.com:/opt/app/.env",
  "rsync -av dist/ deploy@203.0.113.7:/opt/app/dist/",
  "docker -H ssh://deploy@app.example.com compose up -d",
  "DOCKER_HOST=ssh://app.example.com docker restart api",
  "docker context use production",
  "kubectl --context live-eu apply -f k8s/",
  "kubectl --context prod-us delete pod api-0",
  "kubectl config use-context live-eu",
  "psql postgres://admin@app.example.com/app -c 'delete from users'",
  "psql -h app.example.com -U app app",
  "sh -c \"ssh app.example.com 'docker compose down'\"",
];

const PASSED: readonly string[] = [
  "ssh app.example.com docker ps",
  "ssh app.example.com 'docker compose logs --tail 50 api'",
  "ssh 203.0.113.7 'df -h && uptime'",
  "scp app.example.com:/var/log/app.log ./app.log",
  "docker -H ssh://app.example.com ps",
  "kubectl --context live-eu get pods",
  "kubectl --context live-eu logs api-0",
  "psql postgres://ro@app.example.com/app -c 'select count(*) from users'",
  "pg_dump -h app.example.com app",
  "ssh staging.example.com 'docker compose up -d'",
  "docker compose up -d",
  "kubectl --context kind-local apply -f k8s/",
  "psql postgres://localhost/app -c 'delete from users'",
  "rsync -av dist/ ./backup/",
];

describe("prod-edit guard", () => {
  let repo: TempRepo | undefined;

  before(() => {
    repo = tempRepo({
      ".finitemonkey/config.yml": CONFIG,
      ".github/workflows/deploy.yml": WORKFLOW,
      "README.md": "x\n",
    });
  });

  after(() => {
    repo?.dispose();
  });

  for (const command of BLOCKED) {
    it(`blocks: ${command}`, async () => {
      assert.ok(repo);
      const decision = await hook(gitPreToolUse, "PreToolUse", repo.root, bash(command));
      assert.equal(decision.kind, "block", command);
      assert.match(reasonOf(decision), /production/);
    });
  }

  it("passes read-only and non-production commands", async (context) => {
    assert.ok(repo);
    const wrong: string[] = [];
    for (const command of PASSED) {
      const decision = await hook(gitPreToolUse, "PreToolUse", repo.root, bash(command));
      if (decision.kind === "block") wrong.push(`${command} -> ${decision.reason}`);
    }
    context.diagnostic(`false positives: ${String(wrong.length)}/${String(PASSED.length)}`);
    assert.deepEqual(wrong, []);
  });

  it("records read-only production commands as evidence", async () => {
    assert.ok(repo);
    await hook(gitPreToolUse, "PreToolUse", repo.root, bash("ssh app.example.com docker ps"));
    const path = join(repo.root, EVIDENCE_FILE);
    assert.ok(existsSync(path));
    assert.match(readFileSync(path, "utf8"), /"target":"app\.example\.com"/);
  });

  it("names the declared deploy path in the block", async () => {
    assert.ok(repo);
    const decision = await hook(
      gitPreToolUse,
      "PreToolUse",
      repo.root,
      bash("ssh app.example.com 'docker compose up -d'"),
    );
    assert.match(reasonOf(decision), /\.github\/workflows\/deploy\.yml/);
  });
});
