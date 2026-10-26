export interface GeneratedTemplates {
  readonly configHeader: string;
  readonly policyHeader: readonly string[];
  readonly agentsBlock: (commands: { readonly gate: string; readonly doctor: string }) => readonly string[];
  readonly verifySkill: {
    readonly description: string;
    readonly whenToUse: string;
    readonly title: string;
    readonly steps: (command: string) => readonly string[];
  };
}
