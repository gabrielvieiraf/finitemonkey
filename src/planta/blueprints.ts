import type { BlueprintItem, BlueprintType } from "./types.js";

export const SAAS_IDS = [
  "problem",
  "rules",
  "pricing",
  "api",
  "database",
  "auth",
  "password-reset",
  "tenants",
  "states",
  "billing",
  "webhooks",
  "renewal-refund",
  "cents",
  "types",
  "lint",
  "tests",
  "ci",
  "secrets",
  "rate-limit",
  "privacy",
  "backup",
  "environments",
  "rollback",
  "logs",
  "terms",
] as const;

export const LANDING_IDS = [
  "message",
  "call-to-action",
  "contact",
  "responsive",
  "metadata",
  "analytics",
  "visual-check",
  "landing-terms",
  "domain",
] as const;

export type SaasItemId = (typeof SAAS_IDS)[number];
export type LandingItemId = (typeof LANDING_IDS)[number];
export type ItemId = SaasItemId | LandingItemId;

const MIGRATIONS = [
  "migrations/",
  "**/migrations/",
  "prisma/schema.prisma",
  "db/migrate/",
  "drizzle/",
  "alembic/",
  "supabase/migrations/",
];

export const SAAS: readonly BlueprintItem<SaasItemId>[] = [
  { id: "problem", area: "product", after: [], probe: { type: "manual" } },
  {
    id: "rules",
    area: "product",
    after: [],
    probe: { type: "files", any: ["docs/plan/", "docs/rules*", "docs/business*", "docs/decisions/"] },
  },
  { id: "pricing", area: "product", after: ["problem"], probe: { type: "manual" } },
  {
    id: "api",
    area: "application",
    after: [],
    probe: {
      type: "files",
      any: ["api/", "src/api/", "app/api/", "pages/api/", "server/", "src/server/", "backend/", "src/routes/"],
    },
  },
  { id: "database", area: "application", after: [], probe: { type: "files", any: MIGRATIONS } },
  {
    id: "auth",
    area: "application",
    after: ["database"],
    probe: {
      type: "deps",
      any: ["next-auth", "@auth/core", "@clerk/nextjs", "lucia", "passport", "better-auth", "@supabase/supabase-js"],
      orGrep: "sign_?in|log_?in|authenticate",
    },
  },
  {
    id: "password-reset",
    area: "application",
    after: ["auth"],
    probe: { type: "grep", all: ["(reset|forgot)[-_ ]?password|password[-_ ]?reset"] },
  },
  {
    id: "tenants",
    area: "application",
    after: ["auth"],
    probe: { type: "grep", all: ["tenant|organization_?id|org_?id|workspace_?id"] },
  },
  { id: "states", area: "application", after: ["api"], probe: { type: "grep", all: ["loading", "empty", "error"] } },
  {
    id: "billing",
    area: "money",
    after: ["auth"],
    probe: {
      type: "deps",
      any: ["stripe", "asaas", "mercadopago", "@paddle/paddle-node-sdk", "@lemonsqueezy/lemonsqueezy.js"],
      orGrep: "checkout|subscription",
    },
  },
  { id: "webhooks", area: "money", after: ["billing"], probe: { type: "grep", all: ["idempoten"] } },
  { id: "renewal-refund", area: "money", after: ["billing"], probe: { type: "grep", all: ["refund", "renew"] } },
  { id: "cents", area: "money", after: ["billing"], probe: { type: "grep", all: ["cents|centavos|minor_?units"] } },
  {
    id: "types",
    area: "quality",
    after: [],
    probe: { type: "files", any: ["tsconfig.json", "mypy.ini", "pyrightconfig.json", "go.mod", "Cargo.toml"] },
  },
  {
    id: "lint",
    area: "quality",
    after: [],
    probe: {
      type: "files",
      any: ["eslint.config.*", ".eslintrc*", "biome.json", "ruff.toml", ".ruff.toml", ".golangci.yml"],
    },
  },
  { id: "tests", area: "quality", after: [], probe: { type: "contract", kind: "tests" } },
  {
    id: "ci",
    area: "quality",
    after: ["tests"],
    probe: {
      type: "files",
      any: [".github/workflows/*.yml", ".github/workflows/*.yaml", ".gitlab-ci.yml", ".circleci/config.yml"],
    },
  },
  { id: "secrets", area: "security", after: [], probe: { type: "contract", kind: "secrets" } },
  { id: "rate-limit", area: "security", after: ["api"], probe: { type: "grep", all: ["rate[-_ ]?limit|throttl"] } },
  {
    id: "privacy",
    area: "security",
    after: ["auth"],
    probe: { type: "grep", all: ["delete[-_ ]?account|account[-_ ]?deletion|data[-_ ]?export|lgpd|gdpr"] },
  },
  { id: "backup", area: "security", after: ["database"], probe: { type: "manual" } },
  {
    id: "environments",
    area: "operation",
    after: [],
    probe: { type: "files", any: [".env.example", ".env.sample", "**/.env.example"] },
  },
  { id: "rollback", area: "operation", after: ["environments"], probe: { type: "manual" } },
  {
    id: "logs",
    area: "operation",
    after: ["api"],
    probe: { type: "deps", any: ["@sentry/node", "@sentry/nextjs", "@sentry/react", "sentry-sdk", "pino", "winston"] },
  },
  {
    id: "terms",
    area: "legal",
    after: [],
    probe: { type: "files", any: ["**/terms*", "**/privacy*", "**/termos*", "**/privacidade*"] },
  },
];

export const LANDING: readonly BlueprintItem<LandingItemId>[] = [
  { id: "message", area: "product", after: [], probe: { type: "manual" } },
  { id: "call-to-action", area: "application", after: ["message"], probe: { type: "grep", all: ["<button|<a "] } },
  { id: "contact", area: "application", after: [], probe: { type: "grep", all: ["<form|mailto:|wa\\.me/"] } },
  { id: "responsive", area: "application", after: [], probe: { type: "grep", all: ["@media|viewport"] } },
  { id: "metadata", area: "application", after: [], probe: { type: "grep", all: ["<title|og:title|metadata"] } },
  { id: "analytics", area: "operation", after: [], probe: { type: "grep", all: ["gtag|plausible|posthog|analytics"] } },
  { id: "visual-check", area: "quality", after: ["responsive"], probe: { type: "contract", kind: "look" } },
  {
    id: "landing-terms",
    area: "legal",
    after: ["contact"],
    probe: { type: "files", any: ["**/privacy*", "**/privacidade*", "**/privacidad*"] },
  },
  { id: "domain", area: "operation", after: [], probe: { type: "manual" } },
];

export const BLUEPRINTS: Readonly<Record<BlueprintType, readonly BlueprintItem<ItemId>[]>> = {
  saas: SAAS,
  landing: LANDING,
};
