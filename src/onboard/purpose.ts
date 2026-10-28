export const PURPOSES = ["build", "typecheck", "lint", "format", "test", "check"] as const;
export type Purpose = (typeof PURPOSES)[number];
