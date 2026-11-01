import { type Bom, type Component, SPEC_VERSION } from "./sbom-lib.js";

const SERIAL = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const HASH_LENGTH: Readonly<Record<string, number>> = { "SHA-1": 40, "SHA-256": 64, "SHA-384": 96, "SHA-512": 128 };
const SCOPES = ["required", "optional", "excluded"];

const componentProblems = (item: Component): string[] => {
  const where = item["bom-ref"];
  return [
    ...(item.name === "" ? [`${where}: name is empty`] : []),
    ...(item.version === "" ? [`${where}: version is empty`] : []),
    ...(item.purl.startsWith("pkg:npm/") ? [] : [`${where}: purl is not a pkg:npm purl`]),
    ...(item.scope === undefined || SCOPES.includes(item.scope) ? [] : [`${where}: scope ${item.scope}`]),
    ...(item.hashes ?? []).flatMap((hash) =>
      new RegExp(`^[a-f0-9]{${String(HASH_LENGTH[hash.alg] ?? 0)}}$`).test(hash.content) && hash.content !== ""
        ? []
        : [`${where}: ${hash.alg} hash is malformed`],
    ),
    ...(item.licenses !== undefined && item.licenses.length > 1 && item.licenses.some((entry) => "expression" in entry)
      ? [`${where}: an expression must be the only license entry`]
      : []),
  ];
};

export const validateSbom = (bom: Bom): string[] => {
  const refs = [bom.metadata.component, ...bom.components].map((item) => item["bom-ref"]);
  const known = new Set(refs);
  return [
    ...(bom.specVersion === SPEC_VERSION ? [] : [`specVersion is not ${SPEC_VERSION}`]),
    ...(SERIAL.test(bom.serialNumber) ? [] : ["serialNumber is not an RFC 4122 URN"]),
    ...(Number.isInteger(bom.version) && bom.version >= 1 ? [] : ["version is not a positive integer"]),
    ...(TIMESTAMP.test(bom.metadata.timestamp) ? [] : ["metadata.timestamp is not an ISO 8601 UTC date-time"]),
    ...(known.size === refs.length ? [] : ["bom-ref values are not unique"]),
    ...[bom.metadata.component, ...bom.components].flatMap(componentProblems),
    ...bom.dependencies.flatMap((dependency) =>
      [dependency.ref, ...dependency.dependsOn]
        .filter((ref) => !known.has(ref))
        .map((ref) => `dependency ${ref} is not a declared bom-ref`),
    ),
  ];
};
