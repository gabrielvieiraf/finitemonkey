export interface GeneratedTemplates {
  readonly configHeader: string;
  readonly verifySkill: {
    readonly description: string;
    readonly whenToUse: string;
    readonly title: string;
    readonly steps: (command: string) => readonly string[];
  };
}
