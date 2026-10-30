import { isRecord, type JsonObject, parseJsonObject } from "../core/parsed.js";

export const INFRA_FILE = /(?:\.tf|\.tf\.json)$/;
export const MANIFEST_FILE = /(?:^|\/)(?:k8s|kubernetes|manifests?|deploy)\/.+\.ya?ml$/i;

export const touchesInfra = (paths: readonly string[]): boolean =>
  paths.some((path) => INFRA_FILE.test(path) || MANIFEST_FILE.test(path));

export type PlanAction = "create" | "update" | "delete" | "replace";

export interface PlannedChange {
  readonly address: string;
  readonly type: string;
  readonly action: PlanAction;
}

export type PlanFindingKind = "stateful-destroy" | "wildcard-policy" | "secret-output";

export interface PlanFinding {
  readonly kind: PlanFindingKind;
  readonly subject: string;
}

export interface PlanSummary {
  readonly counts: Readonly<Record<PlanAction, number>>;
  readonly changes: readonly PlannedChange[];
  readonly findings: readonly PlanFinding[];
}

export const STATEFUL_TYPES: readonly RegExp[] = [
  /^aws_(?:db_instance|rds_cluster|rds_cluster_instance|s3_bucket|ebs_volume|efs_file_system|dynamodb_table|elasticache_(?:cluster|replication_group)|docdb_cluster|neptune_cluster|redshift_cluster|opensearch_domain|elasticsearch_domain)$/,
  /^google_(?:sql_database_instance|sql_database|storage_bucket|compute_disk|bigtable_instance|spanner_instance|spanner_database|redis_instance|filestore_instance)$/,
  /^azurerm_(?:.*(?:sql|postgresql|mysql|cosmosdb|mariadb).*|storage_account|storage_container|managed_disk|redis_cache)$/,
  /^kubernetes_(?:persistent_volume_claim|persistent_volume|stateful_set)(?:_v1)?$/,
  /^digitalocean_(?:database_cluster|volume|spaces_bucket)$/,
];

const actionOf = (actions: unknown): PlanAction | undefined => {
  if (!Array.isArray(actions)) return undefined;
  const list = actions.filter((item): item is string => typeof item === "string");
  if (list.includes("delete") && list.includes("create")) return "replace";
  if (list.includes("delete")) return "delete";
  if (list.includes("create")) return "create";
  if (list.includes("update")) return "update";
  return undefined;
};

const text = (record: JsonObject, key: string): string => {
  const value = record[key];
  return typeof value === "string" ? value : "";
};

const policyDocuments = (value: unknown): readonly JsonObject[] => {
  if (typeof value === "string") {
    const parsed = parseJsonObject(value);
    return parsed.ok && "Statement" in parsed.value ? [parsed.value] : [];
  }
  if (Array.isArray(value)) return value.flatMap(policyDocuments);
  if (isRecord(value)) return Object.values(value).flatMap(policyDocuments);
  return [];
};

const wildcard = (value: unknown): boolean => {
  if (typeof value === "string") return value === "*" || /^[\w-]+:\*$/.test(value);
  if (Array.isArray(value)) return value.some(wildcard);
  if (isRecord(value)) return Object.values(value).some(wildcard);
  return false;
};

const wildcardStatement = (statement: unknown): boolean => {
  if (!isRecord(statement) || statement["Effect"] === "Deny") return false;
  return wildcard(statement["Action"]) || wildcard(statement["Principal"]);
};

const statementsOf = (document: JsonObject): readonly unknown[] => {
  const statement = document["Statement"];
  return Array.isArray(statement) ? statement : [statement];
};

const SECRET_NAME = /pass(?:word)?|secret|token|private_?key|api_?key|credential/i;

const isStateful = (type: string, extra: readonly string[]): boolean =>
  extra.includes(type) || STATEFUL_TYPES.some((pattern) => pattern.test(type));

export const readPlan = (plan: JsonObject, stateful: readonly string[] = []): PlanSummary => {
  const counts: Record<PlanAction, number> = { create: 0, update: 0, delete: 0, replace: 0 };
  const changes: PlannedChange[] = [];
  const findings: PlanFinding[] = [];
  const resources = Array.isArray(plan["resource_changes"]) ? plan["resource_changes"] : [];
  for (const resource of resources) {
    if (!isRecord(resource) || !isRecord(resource["change"])) continue;
    const action = actionOf(resource["change"]["actions"]);
    if (action === undefined) continue;
    const change = { address: text(resource, "address"), type: text(resource, "type"), action };
    counts[action] += 1;
    changes.push(change);
    if ((action === "delete" || action === "replace") && isStateful(change.type, stateful)) {
      findings.push({ kind: "stateful-destroy", subject: `${change.address} (${action})` });
    }
    const after = resource["change"]["after"];
    if (policyDocuments(after).some((document) => statementsOf(document).some(wildcardStatement))) {
      findings.push({ kind: "wildcard-policy", subject: change.address });
    }
  }
  const outputs = isRecord(plan["output_changes"]) ? plan["output_changes"] : {};
  for (const [name, output] of Object.entries(outputs)) {
    if (isRecord(output) && output["after_sensitive"] !== true && SECRET_NAME.test(name)) {
      findings.push({ kind: "secret-output", subject: name });
    }
  }
  return { counts, changes, findings };
};

export interface ManifestResource {
  readonly kind: string;
  readonly name: string;
}

const MANIFEST_STATEFUL = new Set(["StatefulSet", "PersistentVolumeClaim", "PersistentVolume"]);

export const manifestResources = (source: string): readonly ManifestResource[] =>
  source.split(/^---\s*$/m).flatMap((document) => {
    const kind = /^kind:\s*["']?(\w+)/m.exec(document)?.[1];
    const name = /^metadata:\s*\n(?:\s+.*\n)*?\s+name:\s*["']?([\w.-]+)/m.exec(document)?.[1];
    return kind === undefined || name === undefined ? [] : [{ kind, name }];
  });

export const removedStateful = (
  before: readonly ManifestResource[],
  after: readonly ManifestResource[],
): readonly PlanFinding[] =>
  before
    .filter((item) => MANIFEST_STATEFUL.has(item.kind))
    .filter((item) => !after.some((other) => other.kind === item.kind && other.name === item.name))
    .map((item) => ({ kind: "stateful-destroy", subject: `${item.kind}/${item.name} (delete)` }));
