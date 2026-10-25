import type { Patch } from "./gif.ts";

export interface IndexedFrame {
  readonly indices: Uint8Array;
  readonly delay: number;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export function patches(frames: readonly IndexedFrame[], width: number, height: number, transparent: number): readonly Patch[] {
  const out: Patch[] = [];
  let previous: Uint8Array | undefined;
  for (const frame of frames) {
    if (previous === undefined) {
      out.push({ left: 0, top: 0, width, height, indices: frame.indices, delay: frame.delay });
      previous = frame.indices;
      continue;
    }
    const box = changed(previous, frame.indices, width, height);
    const last = out.at(-1);
    if (box === undefined) {
      if (last !== undefined) out[out.length - 1] = { ...last, delay: last.delay + frame.delay };
      continue;
    }
    out.push(crop(previous, frame.indices, width, box, transparent, frame.delay));
    previous = frame.indices;
  }
  return out;
}

function changed(before: Uint8Array, after: Uint8Array, width: number, height: number): Box | undefined {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (before[row + x] === after[row + x]) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      bottom = y;
    }
  }
  return right < 0 ? undefined : { left, top, right, bottom };
}

function crop(before: Uint8Array, after: Uint8Array, width: number, box: Box, transparent: number, delay: number): Patch {
  const patchWidth = box.right - box.left + 1;
  const patchHeight = box.bottom - box.top + 1;
  const indices = new Uint8Array(patchWidth * patchHeight);
  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      const source = (box.top + y) * width + box.left + x;
      const value = after[source] ?? transparent;
      indices[y * patchWidth + x] = before[source] === value ? transparent : value;
    }
  }
  return { left: box.left, top: box.top, width: patchWidth, height: patchHeight, indices, delay };
}
