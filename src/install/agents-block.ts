import type { Lang } from "../i18n/languages.js";
import type { Runner } from "./hook-entries.js";
import { AGENTS_IMPORT, MD_BLOCK_BEGIN, MD_BLOCK_END } from "./layout.js";
import { type Markers, withManagedBlock, withoutManagedBlock } from "./managed-block.js";
import { cliCommand } from "./skill-template.js";
import { TEMPLATES } from "./templates/index.js";

export const MARKDOWN_MARKERS: Markers = { begin: MD_BLOCK_BEGIN, end: MD_BLOCK_END };

const IMPORT_LINE = /^@AGENTS\.md[ \t]*$/m;

export const withAgentsBlock = (text: string | undefined, runner: Runner, lang: Lang): string =>
  withManagedBlock(
    text,
    MARKDOWN_MARKERS,
    TEMPLATES[lang].agentsBlock({
      gate: cliCommand(runner, "gate --fast --json"),
      doctor: cliCommand(runner, "doctor --json"),
    }),
  );

export const withAgentsImport = (text: string | undefined): string =>
  text !== undefined && IMPORT_LINE.test(withoutManagedBlock(text, MARKDOWN_MARKERS))
    ? text
    : withManagedBlock(text, MARKDOWN_MARKERS, [AGENTS_IMPORT]);

export const withoutMarkdownBlock = (text: string): string => withoutManagedBlock(text, MARKDOWN_MARKERS);
