import { isRecord, type JsonObject } from "../core/parsed.js";

export interface ReportRepo {
  readonly path: string;
  readonly hash: string;
}

export const reposOf = (data: JsonObject | undefined): readonly ReportRepo[] => {
  const value = data?.["repos"];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const { path, hash } = item;
    return typeof path === "string" && typeof hash === "string" ? [{ path, hash }] : [];
  });
};
