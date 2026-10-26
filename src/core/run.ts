import { REGISTRY } from "../commands/index.js";
import type { CommandSpec } from "../commands/types.js";
import { langSettings } from "../i18n/lang-settings.js";
import { detectLang, LANGUAGES, normalizeLang } from "../i18n/languages.js";
import { createTranslator } from "../i18n/translate.js";
import { looseArgs } from "./args.js";
import type { AbsolutePath } from "./brand.js";
import type { Ctx, Env, Io } from "./context.js";
import { dispatch } from "./dispatch.js";
import { render, resultFromThrown } from "./output.js";
import { usageProblem } from "./problem.js";
import { type CommandResult, failureFrom } from "./result.js";
import type { Runtime } from "./runtime.js";

export interface RunOptions {
  readonly argv: readonly string[];
  readonly env: Env;
  readonly cwd: AbsolutePath;
  readonly platform: NodeJS.Platform;
  readonly io: Io;
  readonly version: string;
  readonly runtime: Runtime;
  readonly registry?: readonly CommandSpec[];
}

export const run = async (options: RunOptions): Promise<number> => {
  const loose = looseArgs(options.argv);
  const settings = langSettings(options.runtime, options.cwd, options.env, options.platform);
  const detected = detectLang(loose.lang, options.env, settings);
  const t = createTranslator(detected.lang);
  const ctx: Ctx = {
    lang: detected.lang,
    langSource: detected.source,
    t,
    json: loose.json,
    yes: loose.yes,
    dryRun: loose.dryRun,
    cwd: options.cwd,
    env: options.env,
    platform: options.platform,
    version: options.version,
    io: options.io,
    runtime: options.runtime,
  };
  let name = loose.positionals[0] ?? "";
  let result: CommandResult;
  try {
    if (loose.lang !== undefined && normalizeLang(loose.lang) === undefined) {
      const problem = usageProblem("invalid_lang", "error.invalid_lang", "finitemonkey --lang en", {
        lang: loose.lang,
        languages: LANGUAGES.join(", "),
      });
      result = failureFrom(t, problem);
    } else {
      const dispatched = dispatch(ctx, options.argv, loose, options.registry ?? REGISTRY);
      name = dispatched.name;
      result = await dispatched.execute();
    }
  } catch (thrown) {
    result = resultFromThrown(thrown, t);
  }
  render(ctx, name, result);
  return result.exitCode;
};
