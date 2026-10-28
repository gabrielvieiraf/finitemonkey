export interface PinnedAction {
  readonly sha: string;
  readonly version: string;
}

export const PINNED_ACTIONS = {
  "actions/checkout": { sha: "3d3c42e5aac5ba805825da76410c181273ba90b1", version: "v7.0.1" },
  "actions/setup-node": { sha: "949feb2413d6458794dcd2491c4babbbce0c15c1", version: "v7.1.0" },
  "actions/setup-python": { sha: "6d4fd22b20465ccc0f7354476588e8df7c9ca0e0", version: "v7.1.0" },
  "pnpm/action-setup": { sha: "ea17c68df8912ef543352723c149a84f56e3d413", version: "v6.1.0" },
  "oven-sh/setup-bun": { sha: "0c5077e51419868618aeaa5fe8019c62421857d6", version: "v2.2.0" },
  "astral-sh/setup-uv": { sha: "68559e99cc807c1eb7e9238fd43a15bba460eec2", version: "v10.3.3" },
  "anchore/sbom-action": { sha: "66cbf4bc1f1c0d2edc94016e65bc221b6bb0ad6c", version: "v0.24.3" },
  "actions/attest-build-provenance": { sha: "4d101475d8b20a2381f78447822ac1eab6504dd8", version: "v4.2.2" },
  "google/osv-scanner-action/osv-scanner-action": {
    sha: "b1d267aea5211fa648d9d442fa64b90dbdcbdd36",
    version: "v2.7.0",
  },
  "actions/create-github-app-token": { sha: "64ab729a6294000f5aa4a4bc0b73d1f32bc45510", version: "v3.3.0" },
  "anthropics/claude-code-action": { sha: "d70510b174a1244958df0b03166a54912811f3e6", version: "v1.0.264" },
} as const satisfies Readonly<Record<string, PinnedAction>>;

export type ActionName = keyof typeof PINNED_ACTIONS;

export const pinned = (name: ActionName): string => {
  const action: PinnedAction = PINNED_ACTIONS[name];
  return `${name}@${action.sha} # ${action.version}`;
};
