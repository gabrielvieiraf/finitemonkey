import type { ConceptId } from "./concepts.js";

export interface RecognitionRule {
  readonly concept: ConceptId;
  readonly apis?: readonly RegExp[];
  readonly paths?: readonly RegExp[];
  readonly packages?: readonly string[];
  readonly keywords?: readonly string[];
  readonly cwe?: readonly number[];
}

export const RULES: readonly RecognitionRule[] = [
  {
    concept: "backend/money/rounding",
    apis: [
      /\bMath\.(?:round|floor|ceil|trunc)\s*\([^)]*\*\s*100\b/,
      /\.toFixed\s*\(\s*2\s*\)/,
      /\bnew\s+(?:Decimal|Big|BigNumber|Dinero)\s*\(/,
      /\bIntl\.NumberFormat\s*\([^)]*currency/,
      /\bROUND_HALF_(?:UP|EVEN|DOWN)\b/,
      /\.quantize\s*\(/,
    ],
    paths: [/(^|\/)(?:money|currenc(?:y|ies)|rounding)(?:[/._-]|$)/i],
    packages: ["decimal.js", "decimal.js-light", "big.js", "bignumber.js", "dinero.js", "currency.js", "decimal"],
    keywords: ["money", "currency", "decimal", "rounding", "bignumber", "arbitrary-precision"],
  },
  {
    concept: "backend/time/timezone",
    apis: [
      /\bIntl\.DateTimeFormat\s*\(/,
      /\.getTimezoneOffset\s*\(/,
      /\btimeZone\s*:/,
      /\bTemporal\.ZonedDateTime\b/,
      /\bZoneInfo\s*\(/,
      /\bpytz\.timezone\s*\(/,
      /\.tz\s*\(\s*["']/,
    ],
    paths: [/(^|\/)(?:timezones?|tz)(?:[/._-]|$)/i],
    packages: ["date-fns-tz", "@date-fns/tz", "moment-timezone", "luxon", "spacetime", "pytz", "zoneinfo", "tzdata"],
    keywords: ["timezone", "time-zone", "timezones", "tz", "iana"],
  },
  {
    concept: "security/session/logout",
    apis: [
      /\b(?:req|request)\.session\.destroy\s*\(/,
      /\bsession\.(?:destroy|invalidate|flush)\s*\(/,
      /\b(?:res|response)\.clearCookie\s*\(/,
      /\bcookies\(\)\.delete\s*\(/,
      /\b(?:signOut|logout|logout_user)\s*\(/,
    ],
    paths: [/(^|\/)(?:logout|signout|sign-out)(?:[/._-]|$)/i],
  },
  {
    concept: "security/session/cookie",
    apis: [/\b(?:res|response)\.cookie\s*\(/, /\bSet-Cookie\b/, /\bhttpOnly\s*:/, /\bsameSite\s*:/, /\breq\.session\b/],
    paths: [/(^|\/)sessions?(?:[/._-]|$)/i],
    packages: ["express-session", "cookie-session", "iron-session", "cookie", "cookie-parser", "connect-redis"],
    keywords: ["session", "sessions", "cookie", "cookies"],
    cwe: [384, 613, 614, 1004],
  },
  {
    concept: "security/injection/xss",
    apis: [
      /\.innerHTML\s*=/,
      /\bdangerouslySetInnerHTML\b/,
      /\bdocument\.write\s*\(/,
      /\bv-html\b/,
      /\.insertAdjacentHTML\s*\(/,
      /\bDOMPurify\.sanitize\s*\(/,
    ],
    packages: ["dompurify", "isomorphic-dompurify", "sanitize-html", "xss", "bleach"],
    keywords: ["xss", "sanitize", "sanitizer"],
    cwe: [79, 80],
  },
  {
    concept: "security/injection/sql",
    apis: [
      /\.(?:query|execute|raw|unsafe)\s*\(\s*`[^`]*\$\{/,
      /\.(?:query|execute|raw)\s*\(\s*["'][^"']*["']\s*\+/,
      /["'`]\s*(?:SELECT|INSERT|UPDATE|DELETE)\b[^"'`]*["'`]\s*\+/,
    ],
    cwe: [89, 564],
  },
  {
    concept: "security/injection/command",
    apis: [/\b(?:exec|execSync)\s*\(\s*`[^`]*\$\{/, /\bsubprocess\.\w+\([^)]*shell\s*=\s*True/, /\bos\.system\s*\(/],
    cwe: [77, 78],
  },
  {
    concept: "security/authorization/access-control",
    apis: [
      /\b(?:req|request)\.user\.(?:role|roles|permissions)\b/,
      /\b(?:ownerId|owner_id|authorId|author_id|userId|user_id)\s*(?:!==|===|!=|==)\s*(?:req|request|session|ctx|user|current)/,
      /\b(?:authorize|checkPermission|hasPermission|requireRole|requirePermission|isOwner)\s*\(/,
      /\bability\.can\s*\(/,
      /@(?:PreAuthorize|permission_required|RolesAllowed)\b/,
    ],
    paths: [/(^|\/)(?:policies|permissions|authorization|rbac|acl)(?:[/._-]|$)/i],
    packages: ["@casl/ability", "accesscontrol", "casbin", "oso", "django-guardian"],
    keywords: ["authorization", "acl", "rbac", "abac", "permissions"],
    cwe: [285, 639, 862, 863, 284],
  },
  {
    concept: "security/authentication/login",
    apis: [/\bbcrypt\.(?:hash|compare)\s*\(/, /\bargon2\.(?:hash|verify)\s*\(/, /\bjwt\.(?:sign|verify)\s*\(/],
    packages: ["bcrypt", "bcryptjs", "argon2", "passport", "jsonwebtoken", "jose", "next-auth", "@auth/core"],
    keywords: ["authentication", "oauth", "jwt", "login"],
    cwe: [287, 307, 521, 798],
  },
  {
    concept: "security/request-forgery/ssrf",
    cwe: [918],
  },
  {
    concept: "security/integrity/signature",
    apis: [/\bcrypto\.timingSafeEqual\s*\(/, /\bcreateHmac\s*\(/],
    cwe: [345, 347, 294],
  },
  {
    concept: "security/configuration/cors",
    apis: [/\bAccess-Control-Allow-(?:Origin|Credentials)\b/],
    packages: ["cors", "@fastify/cors"],
    cwe: [942, 346],
  },
  {
    concept: "security/path/traversal",
    apis: [/\bpath\.join\s*\([^)]*\b(?:req|request)\.(?:params|query|body)\b/],
    cwe: [22, 23],
  },
  {
    concept: "backend/api/endpoint",
    apis: [
      /\b(?:app|router|server)\.(?:get|post|put|patch|delete)\s*\(\s*["'`]\//,
      /\bexport\s+(?:async\s+)?function\s+(?:GET|POST|PUT|PATCH|DELETE)\s*\(/,
      /@(?:app|router)\.(?:route|get|post|put|delete)\s*\(/,
      /@(?:Get|Post|Put|Delete|Patch|Request)Mapping\b/,
    ],
    paths: [/(^|\/)(?:api|routes)\//],
    packages: ["express", "fastify", "koa", "hono", "@nestjs/core", "flask", "fastapi"],
  },
  {
    concept: "backend/data/migration",
    apis: [/\bknex\.schema\.\w+/, /\bop\.(?:add_column|create_table|drop_column)\s*\(/, /\bALTER\s+TABLE\b/],
    paths: [/(^|\/)(?:db\/)?migrations?\//],
  },
  {
    concept: "backend/data/sql",
    packages: [
      "pg",
      "mysql2",
      "better-sqlite3",
      "knex",
      "sequelize",
      "typeorm",
      "@prisma/client",
      "drizzle-orm",
      "sqlalchemy",
      "psycopg2",
    ],
    keywords: ["sql", "orm", "postgres", "postgresql", "mysql", "sqlite"],
  },
  {
    concept: "backend/integration/webhook",
    apis: [/\bwebhooks\.constructEvent\s*\(/, /\b(?:stripe|x-hub)-signature\b/i],
    paths: [/webhooks?/i],
  },
  {
    concept: "backend/reliability/idempotency",
    apis: [/\bidempotency[-_]?key\b/i],
  },
  {
    concept: "backend/cache/caching",
    apis: [/\bCache-Control\b/, /\bstale-while-revalidate\b/],
    packages: ["redis", "ioredis", "lru-cache", "node-cache", "keyv", "memcached"],
    keywords: ["cache", "caching", "memoize"],
  },
  {
    concept: "backend/concurrency/locking",
    apis: [
      /\bFOR\s+UPDATE\b/,
      /\bnew\s+Mutex\s*\(/,
      /\bAtomics\.(?:wait|compareExchange)\s*\(/,
      /\bthreading\.Lock\s*\(/,
    ],
    packages: ["async-mutex", "redlock", "proper-lockfile", "p-limit"],
    keywords: ["mutex", "lock", "semaphore", "concurrency"],
    cwe: [362, 367],
  },
  {
    concept: "interface/accessibility/aria",
    apis: [/\baria-[a-z]+=/, /\brole=["'](?:button|dialog|alert|navigation|tab)/],
    packages: ["axe-core", "@axe-core/react", "eslint-plugin-jsx-a11y", "@testing-library/jest-dom"],
    keywords: ["a11y", "accessibility", "aria"],
  },
  {
    concept: "infrastructure/git/merge-conflict",
    apis: [/^<{7} \S/, /^>{7} \S/],
  },
  {
    concept: "security/secrets/secret-in-code",
    cwe: [798, 259, 321],
  },
];

export const RESEARCH_FIELDS: readonly { readonly field: string; readonly hosts: readonly RegExp[] }[] = [
  {
    field: "health",
    hosts: [/(^|\.)(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov|nih\.gov|who\.int|cochranelibrary\.com)$/],
  },
  { field: "health", hosts: [/(^|\.)(?:thelancet\.com|nejm\.org|bmj\.com|examine\.com|clinicaltrials\.gov)$/] },
  { field: "law", hosts: [/(^|\.)(?:planalto\.gov\.br|law\.cornell\.edu|eur-lex\.europa\.eu|jusbrasil\.com\.br)$/] },
  { field: "law", hosts: [/(^|\.)(?:legislation\.gov\.uk|congress\.gov|stf\.jus\.br|stj\.jus\.br)$/] },
  { field: "economics", hosts: [/(^|\.)(?:worldbank\.org|imf\.org|oecd\.org|ibge\.gov\.br|bcb\.gov\.br|nber\.org)$/] },
  { field: "statistics", hosts: [/(^|\.)(?:ourworldindata\.org|data\.un\.org|stats\.oecd\.org)$/] },
];
