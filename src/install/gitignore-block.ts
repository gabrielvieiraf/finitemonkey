import { BLOCK_BEGIN, BLOCK_END, COMMITTED_STATE, STATE_DIR } from "./layout.js";
import { hasManagedBlock, type Markers, withManagedBlock, withoutManagedBlock } from "./managed-block.js";

const MARKERS: Markers = { begin: BLOCK_BEGIN, end: BLOCK_END };

const body = (): readonly string[] => [`${STATE_DIR}/*`, ...COMMITTED_STATE.map((path) => `!${STATE_DIR}/${path}`)];

export const gitignoreBlock = (): readonly string[] => [BLOCK_BEGIN, ...body(), BLOCK_END];

export const withBlock = (text: string | undefined): string => withManagedBlock(text, MARKERS, body());

export const withoutBlock = (text: string): string => withoutManagedBlock(text, MARKERS);

export const hasBlock = (text: string): boolean => hasManagedBlock(text, MARKERS);
