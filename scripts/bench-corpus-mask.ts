import { maskText } from "../src/mask/mask.js";

export const MASKED_HOST = "example.invalid";
export const MASKED_IP = "192.0.2.1";
export const MASKED_DIR = "/masked";

const TLDS = "com|net|org|io|dev|app|cloud|internal|local|lan|corp|br|co|ai|us|uk|de";

const URL_HOST = /\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@"'`]+@)?[^\s/:?#"'`]+/gi;
const SCP_HOST = /\b([\w.-]+@)[a-z0-9.-]+(?=:)/gi;
const EMAIL = /\b([\w.+-]+@)[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const BARE_HOST = new RegExp(`\\b(?:[a-z0-9-]+\\.)+(?:${TLDS})\\b(?![\\w.-]*\\.[a-z])`, "gi");
const ABSOLUTE_PATH = /(^|[\s"'`=(:,])((?:[a-z]:[\\/]|[\\/](?![\\/])|~[\\/])[^\s"'`),;]*)/gi;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const lastSegment = (path: string): string =>
  path
    .split(/[\\/]/)
    .filter((part) => part !== "")
    .pop() ?? "";

const maskPaths = (text: string, roots: readonly string[]): string => {
  const known = roots.reduce(
    (out, root) => out.replace(new RegExp(`${escape(root)}(?=[\\\\/]|\\b|$)`, "g"), "<project>"),
    text,
  );
  return known.replace(ABSOLUTE_PATH, (_match, lead: string, path: string) => {
    const name = lastSegment(path);
    return `${lead}${MASKED_DIR}${name === "" ? "" : `/${name}`}`;
  });
};

const maskHosts = (text: string): string =>
  text
    .replace(URL_HOST, (_match, scheme: string) => `${scheme}${MASKED_HOST}`)
    .replace(SCP_HOST, (_match, user: string) => `${user}${MASKED_HOST}`)
    .replace(EMAIL, (_match, user: string) => `${user}${MASKED_HOST}`)
    .replace(IPV4, MASKED_IP)
    .replace(BARE_HOST, (match) => (match.toLowerCase() === MASKED_HOST ? match : MASKED_HOST));

export const maskSessionText = (text: string, roots: readonly string[]): string =>
  maskPaths(maskHosts(maskText(text)), roots)
    .replaceAll("<project>/", "")
    .replaceAll("<project>", ".");

export const maskSession = (value: unknown, roots: readonly string[]): unknown => {
  if (typeof value === "string") return maskSessionText(value, roots);
  if (Array.isArray(value)) return value.map((item) => maskSession(item, roots));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [maskSessionText(key, roots), maskSession(inner, roots)]),
    );
  }
  return value;
};
