import { BLOCK_BEGIN, BLOCK_END } from "./layout.js";
import { withoutManagedBlock } from "./managed-block.js";

export const withoutHookBlock = (text: string): string =>
  withoutManagedBlock(text, { begin: BLOCK_BEGIN, end: BLOCK_END });
