import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { isRecord, type JsonObject, parseJsonObject } from "../src/core/parsed.js";
import { parseConfigYaml } from "../src/git/project-config.js";
import { callOf, CATALOG } from "../src/guards/remote/catalog.js";
import { classifyCall, remoteExtension } from "../src/guards/remote/classify.js";
import { remotePostToolUse, remotePreToolUse } from "../src/guards/remote/hook.js";
import { hook, tempRepo, write } from "./git-support.js";

const mcp = (tool: string, input: JsonObject = {}): JsonObject => ({
  tool_name: tool,
  tool_input: input,
  tool_use_id: "toolu_1",
});
const bash = (command: string): JsonObject => ({ tool_name: "Bash", tool_input: { command } });

const permission = (output: JsonObject | undefined): unknown => {
  const specific = output?.["hookSpecificOutput"];
  return isRecord(specific) ? specific["permissionDecision"] : undefined;
};

const events = (root: string): readonly JsonObject[] => {
  const file = join(root, ".finitemonkey", "log.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((line) => {
      const parsed = parseJsonObject(line);
      return parsed.ok && parsed.value["event"] === "remote_hold" ? [parsed.value] : [];
    });
};

describe("remote destructive catalog", () => {
  it("every entry ships with positive and hard-negative fixtures that classify as declared", () => {
    for (const entry of CATALOG) {
      assert.ok(entry.positive.length > 0, `${entry.id} has no positive`);
      assert.ok(entry.negative.length > 0, `${entry.id} has no hard negative`);
      for (const call of entry.positive) {
        const found = classifyCall(call);
        assert.equal(found.entry, entry.id, `${entry.id}: ${call.tool} ${JSON.stringify(call.input)}`);
        assert.equal(found.effect, entry.effect);
      }
      for (const call of entry.negative) {
        assert.notEqual(classifyCall(call).entry, entry.id, `${entry.id}: ${call.tool} ${JSON.stringify(call.input)}`);
        if (entry.effect === "destroy") assert.notEqual(classifyCall(call).effect, "destroy", JSON.stringify(call));
      }
    }
  });

  it("an unknown MCP tool with a destroy verb is destroy by heuristic; generic names are not", () => {
    const wipe = classifyCall(callOf("mcp__acme__wipeWorkspace", {}));
    assert.deepEqual([wipe.effect, wipe.heuristic], ["destroy", true]);
    assert.equal(classifyCall(callOf("mcp__acme__sync_workspace", {})).effect, "unknown");
    assert.equal(classifyCall(callOf("Read", { file_path: "/x" })).effect, "unknown");
  });

  it("the project catalog adds destroy patterns and read overrides", () => {
    const extension = remoteExtension(
      parseConfigYaml("remote:\n  destroy:\n    - mcp__acme__archive_*\n  read:\n    - mcp__acme__delete_preview\n"),
    );
    assert.equal(classifyCall(callOf("mcp__acme__archive_org", {}), extension).entry, "project-destroy");
    assert.equal(classifyCall(callOf("mcp__acme__delete_preview", {}), extension).effect, "read");
  });
});

describe("remote destructive hook", () => {
  it("holds delete_user for the person and not list_users, and records the hold with target and decision", async () => {
    const repo = tempRepo();
    try {
      const held = await hook(remotePreToolUse, "PreToolUse", repo.root, mcp("mcp__auth__delete_user", { id: "u7" }));
      assert.equal(held.kind, "allow");
      assert.equal(permission(held.output), "ask");
      const listed = await hook(remotePreToolUse, "PreToolUse", repo.root, mcp("mcp__auth__list_users"));
      assert.equal(permission(listed.output), undefined);
      await hook(remotePostToolUse, "PostToolUse", repo.root, mcp("mcp__auth__delete_user", { id: "u7" }));
      const logged = events(repo.root);
      assert.deepEqual(
        logged.map((event) => [event["entry"], event["target"], event["decision"]]),
        [
          ["mcp-accounts-delete", "mcp__auth__delete_user id=u7", "held"],
          ["mcp-accounts-delete", "mcp__auth__delete_user id=u7", "approved"],
        ],
      );
    } finally {
      repo.dispose();
    }
  });

  it("holds an HTTP DELETE to a remote host and not to localhost", async () => {
    const repo = tempRepo();
    try {
      const remote = await hook(
        remotePreToolUse,
        "PreToolUse",
        repo.root,
        bash("curl -X DELETE https://api.example.com/v1/volumes/vol-1"),
      );
      assert.equal(permission(remote.output), "ask");
      const local = await hook(
        remotePreToolUse,
        "PreToolUse",
        repo.root,
        bash("curl -X DELETE http://127.0.0.1:8080/v1/volumes/vol-1"),
      );
      assert.equal(permission(local.output), undefined);
      assert.equal(events(repo.root)[0]?.["target"], "https://api.example.com/v1/volumes/vol-1");
    } finally {
      repo.dispose();
    }
  });

  it("a destroy found only by the verb heuristic is recorded in shadow and held when active", async () => {
    const repo = tempRepo();
    try {
      const call = mcp("mcp__acme__purge_cache_everything");
      const shadow = await hook(remotePreToolUse, "PreToolUse", repo.root, call);
      assert.equal(permission(shadow.output), undefined);
      assert.equal(events(repo.root)[0]?.["decision"], "shadow");
      write(repo.root, ".finitemonkey/policy.yml", "guards:\n  remote-destructive: active\n");
      const active = await hook(remotePreToolUse, "PreToolUse", repo.root, call);
      assert.equal(permission(active.output), "ask");
      writeFileSync(join(repo.root, ".finitemonkey/policy.yml"), "guards:\n  remote-destructive: off\n");
      const off = await hook(remotePreToolUse, "PreToolUse", repo.root, mcp("mcp__acme__delete_user"));
      assert.equal(permission(off.output), "ask", "a catalog destroy is held even with the flag off");
    } finally {
      repo.dispose();
    }
  });
});
