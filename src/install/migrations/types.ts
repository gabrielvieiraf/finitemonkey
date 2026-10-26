export interface FileMigration {
  readonly path: string;
  readonly migrate: (text: string) => string;
}

export interface Migration {
  readonly version: string;
  readonly files: readonly FileMigration[];
}
