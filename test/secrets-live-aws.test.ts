import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";

import { toAbsolutePath } from "../src/core/brand.js";
import type { TextSource } from "../src/core/context.js";
import { FOOTPRINT } from "../src/core/footprint.js";
import { run } from "../src/core/run.js";
import type { ExecRequest } from "../src/core/runtime.js";
import { AWS_STS, awsHeaders, sigV4Authorization } from "../src/secrets/aws-live.js";
import { execResult, fakeRuntime, TEST_VERSION } from "./support.js";

const ROOT = toAbsolutePath("/home/ana/project");
const ACCESS = "AKIDNOTAREALKEYFORTESTS";
const SECRET = "not-a-real-secret-for-tests-0000000000";
const NOW = "2026-11-03T12:34:56.000Z";

const tty = (): TextSource => Object.assign(Readable.from([]), { isTTY: true });

const live = async (argv: readonly string[], env: Readonly<Record<string, string>>, status = "200") => {
  const requests: ExecRequest[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const runtime = fakeRuntime({
    now: NOW,
    exec: (request) => {
      requests.push(request);
      return execResult(0, `{}\n${status}`);
    },
  });
  const code = await run({
    argv,
    env,
    cwd: ROOT,
    platform: "linux",
    io: {
      stdout: { write: (chunk: string) => out.push(chunk) },
      stderr: { write: (chunk: string) => err.push(chunk) },
      stdin: tty(),
    },
    version: TEST_VERSION,
    runtime,
  });
  return { code, requests, stdout: out.join(""), stderr: err.join("") };
};

const KEYS = { AWS_ACCESS_KEY_ID: ACCESS, AWS_SECRET_ACCESS_KEY: SECRET };
const SEND = ["secrets", "live", "aws", "--env", "AWS_ACCESS_KEY_ID", "--send"];

describe("AWS live check through STS GetCallerIdentity", () => {
  it("signs with SigV4 as the AWS test suite expects", () => {
    const authorization = sigV4Authorization(
      {
        method: "GET",
        host: "example.amazonaws.com",
        path: "/",
        query: "",
        headers: {},
        body: "",
        region: "us-east-1",
        service: "service",
        amzDate: "20150830T123600Z",
      },
      { accessKey: "AKIDEXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY" },
    );
    assert.equal(
      authorization,
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });

  it("without --send it names the host and the headers, and sends nothing", async () => {
    const result = await live(["secrets", "live", "aws", "--env", "AWS_ACCESS_KEY_ID", "--json"], KEYS);
    assert.equal(result.code, 0, result.stdout);
    assert.deepEqual(result.requests, []);
    const data = (JSON.parse(result.stdout) as { data: Record<string, unknown> }).data;
    assert.equal(data["host"], AWS_STS.host);
    assert.equal(data["sent"], false);
    assert.deepEqual(data["sends"], ["Content-Type", "X-Amz-Date", "Authorization"]);
    assert.ok(!result.stdout.includes(SECRET) && !result.stdout.includes(ACCESS));
  });

  it("with --send it prints the host first, signs on stdin and never sends the secret", async () => {
    const result = await live(SEND, KEYS, "403");
    assert.match(result.stderr, /^Contacting sts\.amazonaws\.com/);
    assert.match(result.stderr, /signed POST \(STS GetCallerIdentity\)/);
    const [request] = result.requests;
    assert.ok(request !== undefined);
    assert.ok(request.args.includes("https://sts.amazonaws.com/"));
    assert.ok(request.args.includes(AWS_STS.body));
    const sent = `${request.args.join(" ")}\n${request.input ?? ""}`;
    assert.ok(!sent.includes(SECRET));
    assert.equal(request.input, `${awsHeaders({ accessKey: ACCESS, secretKey: SECRET }, NOW).join("\n")}\n`);
    assert.match(request.input ?? "", /X-Amz-Date: 20261103T123456Z/);
    assert.match(request.input ?? "", /Credential=AKIDNOTAREALKEYFORTESTS\/20261103\/us-east-1\/sts\/aws4_request/);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(SECRET));
    assert.match(result.stdout, /rejected the key/);
  });

  it("adds the session token header only when one is set", async () => {
    const result = await live(SEND, { ...KEYS, AWS_SESSION_TOKEN: "not-a-real-token" });
    assert.match(result.requests[0]?.input ?? "", /X-Amz-Security-Token: not-a-real-token/);
    assert.match(result.requests[0]?.input ?? "", /SignedHeaders=content-type;host;x-amz-date;x-amz-security-token/);
    assert.match(result.stdout, /still works/);
  });

  it("refuses without the secret and never runs from the agent", async () => {
    const missing = await live(SEND, { AWS_ACCESS_KEY_ID: ACCESS });
    assert.equal(missing.code, 2);
    assert.deepEqual(missing.requests, []);
    const agent = await live(SEND, { ...KEYS, CLAUDECODE: "1" });
    assert.equal(agent.code, 4);
    assert.deepEqual(agent.requests, []);
  });

  it("lists the host it may contact in the footprint", () => {
    assert.ok(FOOTPRINT.some((item) => item.id === "secrets-live" && item.targets.includes(AWS_STS.host)));
  });
});
