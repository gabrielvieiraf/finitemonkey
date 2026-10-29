export type Surface = "terminal" | "desktop" | "vscode" | "mobile";

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface ProcessInit {
  readonly cwd?: string;
  readonly timeoutMs?: number;
  readonly stdin?: string;
}

export interface Timer {
  readonly cancel: () => void;
}

export interface PaneOpen {
  readonly id: string;
  readonly title?: string;
}

export interface ModElement {
  readonly type: string;
}

export interface TextProps {
  readonly children: readonly (string | ModElement)[];
  readonly color?: string;
  readonly dimColor?: boolean;
  readonly bold?: boolean;
  readonly key?: string;
}

export interface BoxProps {
  readonly children: readonly ModElement[];
  readonly flexDirection?: "row" | "column";
  readonly columnGap?: number;
  readonly key?: string;
}

export interface ButtonProps {
  readonly key: string;
  readonly label: string;
  readonly hotkey?: string;
  readonly onPress: () => void | Promise<void>;
}

export interface Elements {
  readonly Box: (props: BoxProps) => ModElement;
  readonly Text: (props: TextProps) => ModElement;
  readonly Button: (props: ButtonProps) => ModElement;
}

export interface CommandSpec {
  readonly name: string;
  readonly description: string;
  readonly argumentHint?: string;
  readonly immediate?: true;
}

export interface SessionVersion {
  readonly version: string;
  readonly base?: string;
}

export interface RenderInput {
  readonly component: string;
  readonly surface: Surface;
  readonly requestId: string;
}

export interface ModApi {
  readonly plugin: { readonly name: string; readonly root: string };
  readonly process: {
    readonly run: (argv: readonly string[], init?: ProcessInit) => Promise<ProcessResult>;
  };
  readonly session: {
    readonly version: () => Promise<SessionVersion>;
    readonly surfaces: () => Promise<readonly Surface[]>;
    readonly root: () => Promise<string>;
  };
  readonly clock: {
    readonly after: (ms: number, fn: () => void | Promise<void>) => Timer;
  };
  readonly command: {
    readonly register: (spec: CommandSpec) => Promise<unknown>;
  };
  readonly ui: {
    readonly invalidate: (event: "ui.render") => void;
    readonly resolve: (e: RenderInput) => Elements;
    readonly status: (text: string | undefined) => void;
    readonly log: (text: string) => void;
    readonly open: (pane: PaneOpen) => Promise<unknown>;
    readonly close: (pane: { readonly id: string }) => Promise<void>;
  };
}
