import { isRecord, parseJson } from "../core/parsed.js";
import {
  type AccessConfig,
  type Actor,
  LOCALHOST,
  type Method,
  type Resource,
  type Scenario,
  type ScenarioKind,
  scenariosFor,
} from "./plan.js";

export interface HttpRequest {
  readonly method: Method;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

export interface HttpAnswer {
  readonly status: number;
  readonly body: string;
}

export type Send = (request: HttpRequest) => Promise<HttpAnswer | undefined>;

export interface ScenarioResult {
  readonly id: string;
  readonly kind: ScenarioKind | "setup";
  readonly resource: string;
  readonly actor: Actor;
  readonly method: Method;
  readonly path: string;
  readonly allowed: boolean;
  readonly status: number | null;
  readonly passed: boolean;
}

const ITEM_PARAM = /(?::[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\})$/;
const ORDER: readonly ScenarioKind[] = [
  "owner_reads",
  "other_reads",
  "other_changes",
  "anonymous_reads",
  "other_deletes",
];

export const localUrl = (port: number, path: string): string => `http://${LOCALHOST}:${String(port)}${path}`;

export const headerOf = (line: string): Readonly<Record<string, string>> => {
  const colon = line.indexOf(":");
  if (colon <= 0) return {};
  return { [line.slice(0, colon).trim().toLowerCase()]: line.slice(colon + 1).trim() };
};

const headersFor = (actor: Actor, config: AccessConfig): Readonly<Record<string, string>> =>
  actor === "A" ? headerOf(config.userA) : actor === "B" ? headerOf(config.userB) : {};

const ok = (status: number | undefined): boolean => status !== undefined && status >= 200 && status < 300;

const createdId = (answer: HttpAnswer | undefined, field: string): string | undefined => {
  if (!ok(answer?.status)) return undefined;
  const parsed = parseJson(answer?.body ?? "");
  const value = parsed.ok && isRecord(parsed.value) ? parsed.value[field] : undefined;
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
};

const setupFailed = (resource: Resource, status: number | null): ScenarioResult => ({
  id: `${resource.name}.setup`,
  kind: "setup",
  resource: resource.name,
  actor: "A",
  method: "post",
  path: resource.collection,
  allowed: true,
  status,
  passed: false,
});

const runOne = async (scenario: Scenario, path: string, config: AccessConfig, send: Send): Promise<ScenarioResult> => {
  const changes = scenario.method === "put" || scenario.method === "patch";
  const answer = await send({
    method: scenario.method,
    path,
    headers: headersFor(scenario.actor, config),
    ...(changes ? { body: config.body } : {}),
  });
  const status = answer?.status ?? null;
  return { ...scenario, path, status, passed: scenario.allowed ? ok(answer?.status) : !ok(answer?.status) };
};

const runResource = async (
  resource: Resource,
  config: AccessConfig,
  send: Send,
): Promise<readonly ScenarioResult[]> => {
  const created = await send({
    method: "post",
    path: resource.collection,
    headers: headersFor("A", config),
    body: config.body,
  });
  const id = createdId(created, config.idField);
  if (id === undefined) return [setupFailed(resource, created?.status ?? null)];
  const path = resource.item.replace(ITEM_PARAM, encodeURIComponent(id));
  const planned = [...scenariosFor(resource)].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const results: ScenarioResult[] = [];
  for (const scenario of planned) results.push(await runOne(scenario, path, config, send));
  return results;
};

export const runScenarios = async (
  resources: readonly Resource[],
  config: AccessConfig,
  send: Send,
): Promise<readonly ScenarioResult[]> => {
  const results: ScenarioResult[] = [];
  for (const resource of resources) results.push(...(await runResource(resource, config, send)));
  return results;
};
