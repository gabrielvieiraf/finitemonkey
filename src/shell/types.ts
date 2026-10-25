export type Dialect = "bash" | "powershell";

export interface WordToken {
  readonly kind: "word";
  readonly text: string;
  readonly quoted: boolean;
  readonly dynamic: boolean;
}

export interface OpToken {
  readonly kind: "op";
  readonly text: string;
}

export interface RedirectToken {
  readonly kind: "redirect";
  readonly op: string;
  readonly fd: string;
  readonly target: string;
  readonly body: string | undefined;
}

export type Token = WordToken | OpToken | RedirectToken;

export interface Lexed {
  readonly tokens: readonly Token[];
  readonly substitutions: readonly string[];
  readonly incomplete: boolean;
}

export interface Redirect {
  readonly op: string;
  readonly fd: string;
  readonly target: string;
}

export interface ShellCommand {
  readonly program: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly redirects: readonly Redirect[];
  readonly stdin: string | undefined;
  readonly dir: string | undefined;
  readonly via: readonly string[];
  readonly dynamic: boolean;
}

export interface Normalized {
  readonly commands: readonly ShellCommand[];
  readonly incomplete: boolean;
}

export interface Segment {
  readonly program: string;
  readonly args: readonly string[];
  readonly redirectedFrom: readonly string[];
}
