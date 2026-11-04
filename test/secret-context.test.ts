import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { contextFindings } from "../src/secrets/context.js";
import { secretContextPreToolUse } from "../src/secrets/guards/context-hook.js";
import { hook, tempRepo, write } from "./git-support.js";

const writeFile = (root: string, path: string, content: string): JsonObject => ({
  tool_name: "Write",
  tool_input: { file_path: join(root, path), content },
});

const shadows = (root: string): readonly JsonObject[] => {
  const file = join(root, ".finitemonkey", "log.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonObject(line);
      return parsed.ok && parsed.value["feature"] === "secret-context" ? [parsed.value] : [];
    });
};

describe("secret-context detection", () => {
  it("reports a low-entropy literal assigned to a credential name in config, env and code files", () => {
    assert.deepEqual(contextFindings("config/db.yml", 'host: db\npassword: "hunter2"\n'), [
      { name: "password", line: 2 },
    ]);
    assert.deepEqual(contextFindings(".env", "DB_PASSWORD=hunter2\n"), [{ name: "DB_PASSWORD", line: 1 }]);
    assert.deepEqual(contextFindings("src/client.ts", 'const apiKey = "abc12345";\n'), [{ name: "apiKey", line: 1 }]);
    assert.deepEqual(contextFindings("app/settings.py", "SECRET = 'letmein1'\n"), [{ name: "SECRET", line: 1 }]);
  });

  it("does not report a documented placeholder, a reference, a type, a number or a test fixture", () => {
    assert.deepEqual(contextFindings("config/db.yml", 'password: "changeme"\ntoken: ${API_TOKEN}\n'), []);
    assert.deepEqual(contextFindings(".env.example", "DB_PASSWORD=hunter2\n"), []);
    assert.deepEqual(contextFindings("src/user.ts", "password: string;\nconst token = readToken();\n"), []);
    assert.deepEqual(contextFindings("config/llm.yml", "max_tokens: 1000\ncsrf_token: true\n"), []);
    assert.deepEqual(contextFindings("test/fixtures/db.yml", 'password: "hunter2"\n'), []);
    assert.deepEqual(contextFindings("README.md", 'password: "hunter2"\n'), []);
    assert.deepEqual(contextFindings("src/a.ts", "const passwordHash = 'abcdefgh1';\n"), []);
  });
});

describe("secret-context hook", () => {
  it("a password literal in a config file is blocked at the default level and recorded without the value at level light", async () => {
    const repo = tempRepo();
    try {
      const call = writeFile(repo.root, "config/db.yml", 'password: "hunter2"\n');
      assert.equal((await hook(secretContextPreToolUse, "PreToolUse", repo.root, call)).kind, "block");
      write(repo.root, ".finitemonkey/policy.yml", "level: light\n");
      const shadow = await hook(secretContextPreToolUse, "PreToolUse", repo.root, call);
      assert.equal(shadow.kind, "allow");
      const [logged] = shadows(repo.root);
      assert.deepEqual(logged?.["findings"], [{ name: "password", file: "config/db.yml", line: 1 }]);
      assert.ok(!readFileSync(join(repo.root, ".finitemonkey", "log.jsonl"), "utf8").includes("hunter2"));
      write(repo.root, ".finitemonkey/policy.yml", "level: light\nguards:\n  secret-context: active\n");
      const active = await hook(secretContextPreToolUse, "PreToolUse", repo.root, call);
      assert.equal(active.kind, "block");
      const placeholder = writeFile(repo.root, "config/db.yml", 'password: "changeme"\n');
      assert.equal((await hook(secretContextPreToolUse, "PreToolUse", repo.root, placeholder)).kind, "allow");
    } finally {
      repo.dispose();
    }
  });
});
