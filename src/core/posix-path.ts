export const toPosixPath = (path: string): string => path.replace(/\\/g, "/");

export const withoutCarriageReturn = (line: string): string => (line.endsWith("\r") ? line.slice(0, -1) : line);
