export const ROLES: Readonly<Record<string, readonly string[]>> = {
  "http client": [
    "axios",
    "got",
    "node-fetch",
    "ky",
    "superagent",
    "undici",
    "request",
    "cross-fetch",
    "ofetch",
    "needle",
    "requests",
    "httpx",
    "aiohttp",
    "urllib3",
  ],
  dates: ["moment", "dayjs", "date-fns", "luxon", "arrow", "pendulum"],
  validation: ["zod", "yup", "joi", "ajv", "valibot", "superstruct", "class-validator", "pydantic", "marshmallow"],
  logging: ["winston", "pino", "bunyan", "loglevel", "log4js", "loguru", "structlog"],
  cache: ["ioredis", "redis", "node-cache", "lru-cache", "keyv", "memcached", "cachetools"],
  queue: ["bull", "bullmq", "bee-queue", "agenda", "amqplib", "kafkajs", "celery", "rq"],
  database: [
    "prisma",
    "@prisma/client",
    "typeorm",
    "sequelize",
    "mongoose",
    "drizzle-orm",
    "knex",
    "objection",
    "@mikro-orm/core",
    "sqlalchemy",
    "peewee",
    "tortoise-orm",
  ],
  tests: ["jest", "vitest", "mocha", "ava", "jasmine", "pytest"],
  state: ["redux", "@reduxjs/toolkit", "zustand", "mobx", "jotai", "recoil", "valtio"],
  styling: ["tailwindcss", "styled-components", "@emotion/react", "sass", "bootstrap"],
  "web server": ["express", "fastify", "koa", "@hapi/hapi", "@nestjs/core", "flask", "fastapi", "django"],
  ids: ["uuid", "nanoid", "cuid", "@paralleldrive/cuid2", "ulid"],
  utilities: ["lodash", "underscore", "ramda", "remeda"],
};

const BY_PACKAGE: ReadonlyMap<string, string> = new Map(
  Object.entries(ROLES).flatMap(([role, names]) => names.map((name) => [name.toLowerCase(), role] as const)),
);

export const roleOf = (name: string): string | undefined => BY_PACKAGE.get(name.toLowerCase());

const IMPORT =
  /(?:\bfrom\s+["']([^"']+)["']|\brequire\(\s*["']([^"']+)["']\s*\)|\bimport\(\s*["']([^"']+)["']\s*\)|^\s*import\s+([\w.]+)|^\s*from\s+([\w.]+)\s+import)/gm;

const packageOf = (specifier: string): string => {
  if (specifier.startsWith(".") || specifier.startsWith("/")) return "";
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : ((parts[0] ?? "").split(".")[0] ?? "");
};

export const importedPackages = (text: string): readonly string[] =>
  [
    ...new Set(
      [...text.matchAll(IMPORT)].map((match) =>
        packageOf([match[1], match[2], match[3], match[4], match[5]].find((item) => item !== undefined) ?? ""),
      ),
    ),
  ].filter((name) => name !== "");

const ROLE_WORDS = /(client|service|helper|helpers|utils?|wrapper|api|lib|manager|adapter)$/;

export const stemOf = (file: string): string => {
  const base = (file.split("/").pop() ?? "").replace(/\.[^.]+$/, "").replace(/\.(test|spec)$/, "");
  const flat = base.toLowerCase().replace(/[-_.]/g, "");
  const stripped = flat.replace(ROLE_WORDS, "");
  return stripped.length >= 3 ? stripped : flat;
};
