import { lzw } from "./lzw.ts";
import type { Rgb } from "./quantize.ts";

export interface Patch {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly indices: Uint8Array;
  readonly delay: number;
}

export interface GifSpec {
  readonly width: number;
  readonly height: number;
  readonly palette: readonly Rgb[];
  readonly transparent: number;
  readonly patches: readonly Patch[];
}

const doNotDispose = 1;

export function encodeGif(spec: GifSpec): Uint8Array {
  const parts: Uint8Array[] = [
    ascii("GIF89a"),
    Uint8Array.from([...word(spec.width), ...word(spec.height), 0xf7, spec.transparent, 0]),
    colorTable(spec.palette),
    Uint8Array.from([0x21, 0xff, 0x0b, ...ascii("NETSCAPE2.0"), 0x03, 0x01, 0x00, 0x00, 0x00]),
  ];
  for (const patch of spec.patches) {
    parts.push(
      Uint8Array.from([0x21, 0xf9, 0x04, (doNotDispose << 2) | 1, ...word(patch.delay), spec.transparent, 0x00]),
      Uint8Array.from([0x2c, ...word(patch.left), ...word(patch.top), ...word(patch.width), ...word(patch.height), 0x00, 0x08]),
      lzw(patch.indices, 8),
    );
  }
  parts.push(Uint8Array.from([0x3b]));
  return concat(parts);
}

function colorTable(palette: readonly Rgb[]): Uint8Array {
  const table = new Uint8Array(256 * 3);
  palette.slice(0, 256).forEach(([r, g, b], index) => table.set([r, g, b], index * 3));
  return table;
}

function word(value: number): readonly [number, number] {
  return [value & 255, (value >> 8) & 255];
}

function ascii(value: string): Uint8Array {
  return Uint8Array.from([...value].map((char) => char.charCodeAt(0)));
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
