import { defineRule, type SecretRule } from "./types.js";

const ARGUMENT_CONTEXT = String.raw`(?:^|\n)[ \t-]*(?:command|entrypoint|CMD|ENTRYPOINT|RUN|ExecStart(?:Pre|Post)?|ExecReload)\b[^\n]*?`;

const SECRET_FLAG = String.raw`(?<=[\s"'\[,])--?[A-Za-z0-9_-]*(?:password|passwd|pass|secret|token|requirepass|api-?key)`;

export const EXPOSURE_RULES: readonly SecretRule[] = [
  defineRule({
    id: "secret-in-process-args",
    summary:
      "Literal password, token or key passed as a command-line argument in compose, a Dockerfile or a systemd unit (visible in ps and docker inspect)",
    kind: "practice",
    severity: "warning",
    keywords: ["command", "entrypoint", "cmd", "run", "execstart", "execreload"],
    source: String.raw`${ARGUMENT_CONTEXT}${SECRET_FLAG}(?:=["']?|["'][ \t]*,[ \t]*["']|[ \t]+["']?)(?<secret>[^\s"',\]$\x60/][^\s"',\]\x60]{3,127})`,
    flags: "i",
    minLength: 4,
  }),
  defineRule({
    id: "tls-disabled",
    summary:
      "TLS verification turned off in code: sslmode set to disable, rejectUnauthorized or InsecureSkipVerify set to skip checks, Python verify set to False, NODE_TLS_REJECT_UNAUTHORIZED set to 0",
    kind: "practice",
    severity: "warning",
    keywords: ["sslmode", "rejectunauthorized", "verify", "insecureskipverify", "node_tls_reject_unauthorized"],
    source: String.raw`(?<secret>\bsslmode[ \t]*=[ \t]*["']?disable\b|\brejectUnauthorized["']?[ \t]*:[ \t]*false\b|\bverify[ \t]*=[ \t]*False\b|\bInsecureSkipVerify[ \t]*:[ \t]*true\b|\bNODE_TLS_REJECT_UNAUTHORIZED["']?[ \t]*(?:=|:)[ \t]*["']?0\b)`,
    minLength: 1,
    placeholders: false,
    skipTestPaths: true,
  }),
];
