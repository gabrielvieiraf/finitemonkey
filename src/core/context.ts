import type { Lang, LangSource } from "../i18n/languages.js";
import type { Translate } from "../i18n/translate.js";
import type { AbsolutePath } from "./brand.js";
import type { Runtime } from "./runtime.js";

export interface TextSink {
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface TextSource {
  readonly isTTY?: boolean;
  setEncoding?(encoding: BufferEncoding): unknown;
  on(event: "data", listener: (chunk: string | Buffer) => void): unknown;
  on(event: "end", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
}

export interface Io {
  readonly stdout: TextSink;
  readonly stderr: TextSink;
  readonly stdin: TextSource;
}

export type Env = Readonly<Partial<Record<string, string>>>;

export interface GlobalFlags {
  readonly json: boolean;
  readonly yes: boolean;
  readonly dryRun: boolean;
}

export interface Ctx extends GlobalFlags {
  readonly lang: Lang;
  readonly langSource: LangSource;
  readonly t: Translate;
  readonly cwd: AbsolutePath;
  readonly env: Env;
  readonly platform: NodeJS.Platform;
  readonly version: string;
  readonly io: Io;
  readonly runtime: Runtime;
}
