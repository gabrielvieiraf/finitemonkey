export const INVENTORY_SCHEMA = "finitemonkey/inventory@1";

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export interface EnvName {
  readonly name: string;
  readonly at: readonly string[];
}

export interface Dependency {
  readonly name: string;
  readonly version: string;
  readonly at: string;
}

export interface CredentialHit {
  readonly at: string;
  readonly rule: string;
}

export interface Module {
  readonly path: string;
  readonly files: number;
}

export interface Hotspot {
  readonly path: string;
  readonly changes: number;
}

export interface RepoRead {
  readonly path: string;
  readonly hash: string;
  readonly ref: string;
  readonly modules: readonly Module[];
  readonly routes: readonly Hit[];
  readonly tables: readonly Hit[];
  readonly queues: readonly Hit[];
  readonly jobs: readonly Hit[];
  readonly env: readonly EnvName[];
  readonly dependencies: readonly Dependency[];
  readonly tests: readonly string[];
  readonly credentials: readonly CredentialHit[];
  readonly deploy: readonly string[];
  readonly hotspots: readonly Hotspot[];
  readonly worktrees: readonly string[];
}

export interface Inventory {
  readonly schema: typeof INVENTORY_SCHEMA;
  readonly topic: string;
  readonly date: string;
  readonly covered: readonly string[];
  readonly repos: readonly RepoRead[];
  readonly delta: readonly string[];
  readonly previousHash?: string;
  readonly incidents: readonly string[];
}
