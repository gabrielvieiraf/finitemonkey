const maxCode = 4096;

export function lzw(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const bytes: number[] = [];
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let table = new Map<number, number>();
  let buffer = 0;
  let bits = 0;

  const emit = (code: number): void => {
    buffer |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(buffer & 255);
      buffer >>>= 8;
      bits -= 8;
    }
  };

  emit(clear);
  let current = indices[0] ?? 0;
  for (let position = 1; position < indices.length; position += 1) {
    const value = indices[position] ?? 0;
    const key = (current << 8) | value;
    const found = table.get(key);
    if (found !== undefined) {
      current = found;
      continue;
    }
    emit(current);
    if (next === maxCode) {
      emit(clear);
      table = new Map<number, number>();
      next = end + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= 1 << codeSize) codeSize += 1;
      table.set(key, next);
      next += 1;
    }
    current = value;
  }
  emit(current);
  emit(end);
  if (bits > 0) bytes.push(buffer & 255);
  return subBlocks(bytes);
}

function subBlocks(bytes: readonly number[]): Uint8Array {
  const out: number[] = [];
  for (let start = 0; start < bytes.length; start += 255) {
    const chunk = bytes.slice(start, start + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return Uint8Array.from(out);
}
