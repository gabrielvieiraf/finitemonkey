import { type RouteHandler, routeHandlers } from "./handlers.js";
import type { RuleHit, ScanContext } from "./types.js";

const DB =
  /\b(?:prisma|db|knex|sql|pool|supabase|drizzle|cursor|conn|connection)\s*\.\s*\w+|\bsession\s*\.\s*(?:query|execute|add|get|scalars|delete)\b|\.objects\.|\.(?:findMany|findUnique|findFirst|upsert)\(|\bawait\s+\w+\.(?:query|execute)\(/;
const SENSITIVE = /login|signin|sign-in|password|reset|otp|verify|token|register|signup|sign-up|2fa|mfa/i;
const LIMITER = /rateLimit|rate_limit|ratelimit|limiter|throttle|Throttle|slowapi|RateLimiter|@limits/i;
const WEBHOOK = /webhook/i;
const SIGNATURE_CHECK =
  /timingSafeEqual|constructEvent|verifySignature|verifyWebhook|validateWebhook|compare_digest|webhooks\.verify|\.verify\(|svix|unwrap\(/i;
const SIGNATURE_EQUALS = /\bsig\w*\s*(?:===?|!==?)\s*\w+|\w+\s*(?:===?|!==?)\s*\bsig\w*/i;
const IDEMPOTENT = /idempoten|event\.id|eventId|event_id|processedEvents|already processed|upsert|ON CONFLICT|unique/i;
const OWNER =
  /\b(?:user|owner|tenant|org|organization|account|team|workspace|company|author|created_by)(?:_?id|Id)?\b/i;
const REQUEST_ID =
  /\b(?:params|req\.params|request\.params|req\.query|req\.body|body|query|input|searchParams\.get\([^)]*\)|kwargs|path_params)\b/;
const SQL_CONCAT =
  /(?:\$queryRawUnsafe|\$executeRawUnsafe)\s*\(|\b(?:query|execute|raw|exec)\s*\(\s*(?:`[^`]*\$\{|(["'])[^"']*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"']*\1\s*\+|f"[^"]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*\{|f'[^']*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^']*\{)/i;
const FETCHERS =
  /\b(?:fetch|axios(?:\.(?:get|post|put|request))?|got|ky|request|https?\.get|requests\.(?:get|post)|httpx\.(?:get|post)|urlopen)\s*\(\s*([\w.[\]'"]+)/g;
const FROM_REQUEST =
  /^(?:req|request)\.(?:body|query|params|args|GET|POST|json)\b|^(?:body|query|params|input)\.|searchParams\.get/;
const TAINTED =
  /(?:const|let|var)?\s*(\w+)\s*=\s*(?:await\s+)?(?:req|request)\.(?:body|query|params|args|GET|POST)\b[\w.[\]'"]*|(\w+)\s*=\s*(?:\w+\.)?searchParams\.get\(/g;
const CORS_ANY =
  /origin\s*:\s*(?:['"`]\*['"`]|true)|allow_origins\s*=\s*\[\s*["']\*["']\s*\]|Access-Control-Allow-Origin['"]?\s*,\s*['"]\*['"]/;
const CORS_CREDENTIALS =
  /credentials\s*:\s*true|allow_credentials\s*=\s*True|Access-Control-Allow-Credentials['"]?\s*,\s*['"]true['"]/;

const lines = (text: string): readonly string[] => text.split("\n");

const mentions = (text: string, names: readonly string[]): boolean =>
  names.some((name) => new RegExp(`(?:^|[^\\w])${name.replace(/[$]/g, "\\$")}\\b`).test(text));

const beforeDb = (body: string): string => {
  const index = lines(body).findIndex((line) => DB.test(line));
  return index === -1
    ? body
    : lines(body)
        .slice(0, index + 1)
        .join("\n");
};

const routeAuth = (handler: RouteHandler, ctx: ScanContext): RuleHit[] => {
  if (handler.fileGuarded || ctx.publicRoutes.has(handler.route) || !DB.test(handler.body)) return [];
  if (mentions(handler.prelude, ctx.guards) || mentions(beforeDb(handler.body), ctx.guards)) return [];
  return [{ rule: "route-auth", line: handler.line, detail: handler.route }];
};

const rateLimit = (handler: RouteHandler, fileText: string): RuleHit[] =>
  SENSITIVE.test(handler.route) && !LIMITER.test(fileText) && !LIMITER.test(handler.prelude)
    ? [{ rule: "rate-limit", line: handler.line, detail: handler.route }]
    : [];

const webhook = (file: string, text: string, handlers: readonly RouteHandler[]): RuleHit[] => {
  const hooks = handlers.filter((handler) => WEBHOOK.test(handler.route) || WEBHOOK.test(file));
  return hooks.flatMap((handler): RuleHit[] => {
    const equals = lines(handler.body).findIndex((line) => SIGNATURE_EQUALS.test(line));
    const signature: RuleHit[] =
      equals >= 0
        ? [{ rule: "webhook-signature", line: handler.line + equals, detail: "compared with ===" }]
        : SIGNATURE_CHECK.test(handler.body)
          ? []
          : [{ rule: "webhook-signature", line: handler.line, detail: handler.route }];
    const replay: RuleHit[] =
      IDEMPOTENT.test(handler.body) || IDEMPOTENT.test(text)
        ? []
        : [{ rule: "webhook-replay", line: handler.line, detail: handler.route }];
    return [...signature, ...replay];
  });
};

const perLine = (text: string, test: (line: string) => string | undefined, rule: RuleHit["rule"]): RuleHit[] =>
  lines(text).flatMap((line, index) => {
    const detail = test(line);
    return detail === undefined ? [] : [{ rule, line: index + 1, detail }];
  });

const ownerFilter = (line: string): string | undefined => {
  const prisma = /where\s*:\s*\{([^}]*)\}/.exec(line);
  if (
    prisma !== null &&
    /\bid\s*:/.test(prisma[1] ?? "") &&
    REQUEST_ID.test(prisma[1] ?? "") &&
    !OWNER.test(prisma[1] ?? "")
  )
    return "where id";
  if (
    /\beq\(\s*\w+\.id\s*,/.test(line) &&
    REQUEST_ID.test(line) &&
    !/\band\(/.test(line) &&
    !OWNER.test(line.replace(/\w+\.id\b/, ""))
  )
    return "eq(id)";
  if (/\.objects\.(?:get|filter)\(\s*(?:pk|id)\s*=/.test(line) && !OWNER.test(line.replace(/\b(?:pk|id)\s*=/, "")))
    return "objects.get(id)";
  if (/session\.get\(\s*\w+\s*,\s*\w*id\b/.test(line) && !OWNER.test(line.replace(/\w*id\b/, "")))
    return "session.get(id)";
  return undefined;
};

const ssrf = (text: string): RuleHit[] => {
  const tainted = new Set(
    [...text.matchAll(TAINTED)].map((match) => match[1] ?? match[2] ?? "").filter((name) => name !== ""),
  );
  return lines(text).flatMap((line, index) =>
    [...line.matchAll(FETCHERS)].flatMap((match): RuleHit[] => {
      const arg = match[1] ?? "";
      return FROM_REQUEST.test(arg) || tainted.has(arg) ? [{ rule: "ssrf", line: index + 1, detail: arg }] : [];
    }),
  );
};

const cors = (text: string): RuleHit[] => {
  const all = lines(text);
  return all.flatMap((line, index): RuleHit[] => {
    if (!CORS_ANY.test(line)) return [];
    const window = all.slice(Math.max(0, index - 10), index + 11).join("\n");
    return CORS_CREDENTIALS.test(window) ? [{ rule: "cors-credentials", line: index + 1, detail: line.trim() }] : [];
  });
};

export const scanRules = (file: string, text: string, ctx: ScanContext): readonly RuleHit[] => {
  const handlers = routeHandlers(file, text, ctx.guards);
  return [
    ...handlers.flatMap((handler) => routeAuth(handler, ctx)),
    ...handlers.flatMap((handler) => rateLimit(handler, text)),
    ...webhook(file, text, handlers),
    ...perLine(text, ownerFilter, "owner-filter"),
    ...ssrf(text),
    ...cors(text),
    ...perLine(text, (line) => (SQL_CONCAT.test(line) ? line.trim().slice(0, 80) : undefined), "sql-concat"),
  ].sort((left, right) => left.line - right.line || left.rule.localeCompare(right.rule));
};
