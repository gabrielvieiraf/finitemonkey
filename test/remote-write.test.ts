import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { callOf } from "../src/guards/remote/catalog.js";
import { classifyCall, classifyWithScripts } from "../src/guards/remote/classify.js";
import { codeCall } from "../src/guards/remote/code.js";
import { remotePreToolUse } from "../src/guards/remote/hook.js";
import { hook, tempRepo, write } from "./git-support.js";

const mcp = (tool: string, input: JsonObject = {}): JsonObject => ({ tool_name: tool, tool_input: input });
const bash = (command: string): JsonObject => ({ tool_name: "Bash", tool_input: { command } });

const permission = (output: JsonObject | undefined): unknown => {
  const specific = output?.["hookSpecificOutput"];
  return isRecord(specific) ? specific["permissionDecision"] : undefined;
};

const holds = (root: string): readonly JsonObject[] => {
  const file = join(root, ".fm", "log.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonObject(line);
      return parsed.ok && parsed.value["event"] === "remote_hold" ? [parsed.value] : [];
    });
};

const ACTIVE = "guards:\n  remote-destructive: active\n";
const POST_SCRIPT = "import requests\nrequests.post('https://api.example.com/orders', json={'id': 1})\n";

describe("remote write classification", () => {
  it("classifies MCP write verbs, agent-built POST, PUT and PATCH to remote hosts, and leaves reads alone", () => {
    assert.equal(classifyCall(callOf("mcp__gmail__send_email", {})).effect, "write");
    assert.deepEqual(
      [classifyCall(callOf("mcp__acme__publishRelease", {})).effect, classifyCall(callOf("mcp__acme__x", {})).effect],
      ["write", "unknown"],
    );
    assert.equal(
      classifyCall(callOf("Bash", { command: "curl -X PUT https://api.example.com/a -d x" })).effect,
      "write",
    );
    assert.equal(classifyCall(callOf("Bash", { command: "curl https://api.example.com/a" })).effect, "unknown");
    assert.equal(classifyCall(callOf("Bash", { command: "curl -d x http://127.0.0.1:3000/a" })).effect, "unknown");
    assert.equal(
      classifyCall(callOf("Bash", { command: "curl -G -d q=1 https://api.example.com/a" })).effect,
      "unknown",
    );
  });

  it("scans a script file passed to an interpreter for remote writes and deletes", () => {
    const files: Readonly<Record<string, string>> = {
      "post.py": POST_SCRIPT,
      "tools/rm.mjs": "await fetch('https://api.example.com/users/1', { method: 'DELETE' });\n",
      "local.py": "import requests\nrequests.post('http://localhost:8000/orders')\n",
    };
    const read = (path: string): string | undefined => files[path];
    const post = classifyWithScripts(callOf("Bash", { command: "python3 post.py" }), undefined, read);
    assert.deepEqual([post.effect, post.entry], ["write", "script-file-write"]);
    const removed = classifyWithScripts(callOf("Bash", { command: "cd tools && node rm.mjs" }), undefined, read);
    assert.deepEqual([removed.effect, removed.entry], ["destroy", "script-file-delete"]);
    assert.equal(
      classifyWithScripts(callOf("Bash", { command: "python3 local.py" }), undefined, read).effect,
      "unknown",
    );
    assert.equal(
      classifyWithScripts(callOf("Bash", { command: "python3 gone.py" }), undefined, read).effect,
      "unknown",
    );
  });

  it("finds the URL nearest to a method option in code", () => {
    assert.deepEqual(codeCall("fetch('https://a.example.com/x', { method: 'PATCH' })"), {
      effect: "write",
      url: "https://a.example.com/x",
    });
    assert.equal(codeCall("requests.get('https://a.example.com/x')"), undefined);
  });
});

describe("remote write hook", () => {
  it("a fixture MCP send_email and a POST to a non-local host are held; a GET is not; a script file with the same call is held", async () => {
    const repo = tempRepo();
    try {
      write(repo.root, ".fm/policy.yml", ACTIVE);
      write(repo.root, "scripts/notify.py", POST_SCRIPT);
      const email = await hook(remotePreToolUse, "PreToolUse", repo.root, mcp("mcp__gmail__send_email", { to: "a" }));
      assert.equal(permission(email.output), "ask");
      const post = bash("curl -X POST https://api.example.com/v1/orders -d '{}'");
      assert.equal(permission((await hook(remotePreToolUse, "PreToolUse", repo.root, post)).output), "ask");
      const get = bash("curl https://api.example.com/v1/orders");
      assert.equal(permission((await hook(remotePreToolUse, "PreToolUse", repo.root, get)).output), undefined);
      const script = bash("python3 scripts/notify.py");
      assert.equal(permission((await hook(remotePreToolUse, "PreToolUse", repo.root, script)).output), "ask");
      assert.deepEqual(
        holds(repo.root).map((event) => [event["entry"], event["effect"], event["decision"]]),
        [
          ["mcp-write", "write", "held"],
          ["http-write", "write", "held"],
          ["script-file-write", "write", "held"],
        ],
      );
    } finally {
      repo.dispose();
    }
  });

  it("a remote write is recorded in shadow by default and not held", async () => {
    const repo = tempRepo();
    try {
      const sent = await hook(remotePreToolUse, "PreToolUse", repo.root, mcp("mcp__slack__post_message"));
      assert.equal(permission(sent.output), undefined);
      assert.deepEqual(
        holds(repo.root).map((event) => [event["effect"], event["decision"]]),
        [["write", "shadow"]],
      );
    } finally {
      repo.dispose();
    }
  });

  it("a script file that deletes a remote resource is held even with the flag in shadow", async () => {
    const repo = tempRepo();
    try {
      write(repo.root, "rm.js", "require('axios').delete('https://api.example.com/users/1');\n");
      const held = await hook(remotePreToolUse, "PreToolUse", repo.root, bash("node rm.js"));
      assert.equal(permission(held.output), "ask");
      assert.equal(holds(repo.root)[0]?.["entry"], "script-file-delete");
    } finally {
      repo.dispose();
    }
  });
});
