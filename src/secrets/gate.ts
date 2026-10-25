import type { AbsolutePath } from "../core/brand.js";
import { accept, type Parsed } from "../core/parsed.js";
import { toPosixPath } from "../core/posix-path.js";
import type { Runtime } from "../core/runtime.js";
import { loadBaseline, ratchet } from "./baseline.js";
import { type Incident, listIncidents } from "./incidents.js";
import type { LocatedFinding } from "./located.js";
import { scanFile, scanStaged } from "./scan.js";

export interface SecretsGateStatus {
  readonly findings: readonly LocatedFinding[];
  readonly openIncidents: readonly Incident[];
}

const untracked = (runtime: Runtime, root: AbsolutePath): readonly LocatedFinding[] => {
  const listed = runtime.git(["ls-files", "-z", "--others", "--exclude-standard"], root);
  if (!listed.ok) return [];
  return listed.stdout
    .split("\u0000")
    .map(toPosixPath)
    .filter((file) => file !== "" && !file.startsWith(".finitemonkey/"))
    .flatMap((file) => scanFile(runtime, root, file));
};

export const secretsGateStatus = (runtime: Runtime, root: AbsolutePath, since: string): Parsed<SecretsGateStatus> => {
  const changed = scanStaged(runtime, root, true);
  if (!changed.ok) return changed;
  const baseline = loadBaseline(runtime, root);
  if (!baseline.ok) return baseline;
  const outcome = ratchet([...changed.value, ...untracked(runtime, root)], baseline.value, runtime.now(), undefined);
  const openIncidents = listIncidents(runtime, root).filter(
    (incident) => incident.createdAt >= since && incident.state !== "rotacionado" && incident.state !== "fechado",
  );
  return accept({ findings: [...outcome.fresh, ...outcome.expired], openIncidents });
};
