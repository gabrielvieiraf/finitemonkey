import { createHash } from "node:crypto";

export const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

export const fingerprintOf = (secret: string): string => sha256Hex(`finitemonkey:secret:${secret}`).slice(0, 16);

const ALNUM = /[A-Za-z0-9]/g;
const MIN_TAIL_LENGTH = 12;

export const tailOf = (secret: string): string => {
  const visible = (secret.match(ALNUM) ?? []).join("");
  return visible.length >= MIN_TAIL_LENGTH ? visible.slice(-4) : "****";
};
