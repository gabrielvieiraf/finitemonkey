export interface Check {
  readonly label: string;
  readonly fail: string;
  readonly pass: string;
  readonly passesAtRun: number;
}
