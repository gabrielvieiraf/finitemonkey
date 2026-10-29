export const LOOK_RULES = [
  "look/overflow",
  "look/console-error",
  "look/request-failed",
  "look/i18n-key",
  "look/broken-image",
  "look/touch-target",
  "look/banned-copy",
  "look/drift",
  "look/repeated-layout",
  "a11y/contrast",
  "a11y/non-text-contrast",
  "a11y/target-size",
  "a11y/reflow",
  "a11y/clipped-text",
  "a11y/name",
  "a11y/label",
  "a11y/alt",
  "a11y/landmark",
  "a11y/engine",
  "keyboard/unreachable",
  "keyboard/trap",
  "keyboard/focus-invisible",
  "keyboard/focus-obscured",
  "keyboard/order",
  "keyboard/dialog",
  "ui-states/not-covered",
  "ui-states/loading",
  "ui-states/empty",
  "ui-states/error-text",
  "ui-states/error-action",
  "ui-states/error-color",
  "ui-states/partial",
  "ui-states/status",
  "ui/dont",
  "ds/off-token",
  "ds/font-small",
  "ds/literal",
  "ds/no-tokens",
  "default-look/pill",
  "default-look/gradient",
  "default-look/default-font",
  "default-look/emoji-icon",
  "default-look/same-shadow",
] as const;

export type LookRule = (typeof LOOK_RULES)[number];

export const BLOCKING_RULES: readonly LookRule[] = [
  "look/overflow",
  "look/console-error",
  "look/request-failed",
  "look/i18n-key",
  "look/broken-image",
  "look/banned-copy",
];

export const VIEWPORTS = [1440, 390] as const;

export interface LookFinding {
  readonly rule: LookRule;
  readonly route: string;
  readonly viewport: number;
  readonly detail: string;
  readonly blocking: boolean;
  readonly allowedBy?: string;
  readonly feature?: string;
  readonly selector?: string;
  readonly id?: string;
  readonly unverified?: true;
  readonly baseline?: true;
}

export interface LookCapture {
  readonly route: string;
  readonly viewport: number;
  readonly path: string;
}

export interface LookSummary {
  readonly schema: "finitemonkey/look@1";
  readonly treeHash: string;
  readonly at: string;
  readonly failures: number;
  readonly notes: number;
  readonly captures: readonly LookCapture[];
  readonly contactSheet: string | null;
  readonly findings: readonly LookFinding[];
  readonly ignoredAllows: readonly string[];
  readonly blockedRequests?: readonly string[];
}

export const LOOK_SCHEMA = "finitemonkey/look@1";
