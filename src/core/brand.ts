import { isAbsolute, resolve } from "node:path";

declare const brand: unique symbol;

export type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type AbsolutePath = Brand<string, "AbsolutePath">;

export const toAbsolutePath = (path: string, base?: AbsolutePath): AbsolutePath =>
  (isAbsolute(path) || !base ? resolve(path) : resolve(base, path)) as AbsolutePath;
