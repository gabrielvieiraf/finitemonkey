import type { YamlValue } from "../core/yaml/scalar.js";
import { stringifyYaml } from "../core/yaml/write.js";
import type { Stack } from "./stack.js";
import { type AppsecRule, OWASP, RULE_OWASP } from "./types.js";

export const SEMGREP_FILE = ".finitemonkey/semgrep/appsec.yml";

const JS = ["javascript", "typescript"];
const PY = ["python"];

interface SemgrepRule {
  readonly id: string;
  readonly rule: AppsecRule;
  readonly languages: readonly string[];
  readonly message: string;
  readonly patterns: readonly string[];
  readonly call?: string;
}

const JS_RULES: readonly SemgrepRule[] = [
  {
    id: "sql-concat-js",
    rule: "sql-concat",
    languages: JS,
    message: "SQL built from strings; pass values as parameters.",
    patterns: [
      "$DB.query(`...${$X}...`, ...)",
      '$DB.query("..." + $X, ...)',
      "$P.$queryRawUnsafe(...)",
      "$P.$executeRawUnsafe(...)",
    ],
  },
  {
    id: "ssrf-js",
    rule: "ssrf",
    languages: JS,
    message: "A URL from the request is fetched by the server; allow-list the destination.",
    patterns: ["$CALL($REQ.query.$X, ...)", "$CALL($REQ.body.$X, ...)", "$CALL($REQ.params.$X, ...)"],
    call: "^(fetch|got|ky|axios|axios\\.(get|post|request))$",
  },
  {
    id: "cors-credentials-js",
    rule: "cors-credentials",
    languages: JS,
    message: "Any origin with credentials; list the allowed origins.",
    patterns: [
      'cors({..., origin: "*", ..., credentials: true, ...})',
      "cors({..., origin: true, ..., credentials: true, ...})",
    ],
  },
  {
    id: "webhook-signature-js",
    rule: "webhook-signature",
    languages: JS,
    message: "Signature compared with ===; use crypto.timingSafeEqual.",
    patterns: [
      "crypto.createHmac(...).update(...).digest(...) === $X",
      "$X === crypto.createHmac(...).update(...).digest(...)",
      "crypto.createHmac(...).update(...).digest(...) !== $X",
      "$X !== crypto.createHmac(...).update(...).digest(...)",
    ],
  },
];

const PY_RULES: readonly SemgrepRule[] = [
  {
    id: "sql-concat-py",
    rule: "sql-concat",
    languages: PY,
    message: "SQL built from strings; pass values as parameters.",
    patterns: ['$C.execute(f"...")', '$C.execute("..." + $X)', '$C.execute("..." % $X)'],
  },
  {
    id: "ssrf-py",
    rule: "ssrf",
    languages: PY,
    message: "A URL from the request is fetched by the server; allow-list the destination.",
    patterns: ["$CALL($REQ.args.get(...), ...)", "$CALL($REQ.query_params.get(...), ...)"],
    call: "^(requests|httpx)\\.(get|post)|urlopen$",
  },
  {
    id: "cors-credentials-py",
    rule: "cors-credentials",
    languages: PY,
    message: "Any origin with credentials; list the allowed origins.",
    patterns: ['$APP.add_middleware(CORSMiddleware, ..., allow_origins=["*"], ..., allow_credentials=True, ...)'],
  },
];

const toYaml = (rule: SemgrepRule): YamlValue => ({
  id: `finitemonkey.${rule.id}`,
  languages: [...rule.languages],
  severity: "ERROR",
  message: `${rule.message} (${OWASP[RULE_OWASP[rule.rule]]})`,
  metadata: { owasp: OWASP[RULE_OWASP[rule.rule]], rule: rule.rule },
  ...(rule.call === undefined
    ? { "pattern-either": rule.patterns.map((pattern) => ({ pattern })) }
    : {
        patterns: [
          { "pattern-either": rule.patterns.map((pattern) => ({ pattern })) },
          { "metavariable-regex": { metavariable: "$CALL", regex: rule.call } },
        ],
      }),
});

const usesJs = (stack: Stack): boolean =>
  stack.frameworks.some((framework) => framework !== "fastapi" && framework !== "django") ||
  stack.orms.includes("prisma") ||
  stack.orms.includes("drizzle");

const usesPython = (stack: Stack): boolean =>
  stack.frameworks.includes("fastapi") || stack.frameworks.includes("django") || stack.orms.includes("sqlalchemy");

export const semgrepRules = (stack: Stack): string =>
  stringifyYaml({
    rules: [...(usesJs(stack) ? JS_RULES : []), ...(usesPython(stack) ? PY_RULES : [])].map(toYaml),
  });
