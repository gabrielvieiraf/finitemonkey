import { toAbsolutePath } from "../core/brand.js";
import type { Runtime } from "../core/runtime.js";

export type Fetched =
  | { readonly status: "ok"; readonly content: string }
  | { readonly status: "not-found" }
  | { readonly status: "unreachable"; readonly detail: string };

export type SourceFetcher = (id: string) => Fetched;

export const FETCH_TIMEOUT_S = 20;

const DOI = /^10\.\d{4,9}\/\S+$/;

export const urlOf = (id: string): string | undefined => {
  if (DOI.test(id)) return `https://doi.org/${id}`;
  return /^https?:\/\//i.test(id) ? id : undefined;
};

const SECRET_FILE = /(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i;

export const localSource = (id: string): boolean =>
  !id.startsWith("/") && !/^[A-Za-z]:/.test(id) && !id.split(/[\\/]/).includes("..") && !SECRET_FILE.test(id);

const STATUS = /\n(\d{3})$/;

const fromCurl = (stdout: string): Fetched => {
  const match = STATUS.exec(stdout);
  const code = match === null ? 0 : Number(match[1]);
  const content = match === null ? stdout : stdout.slice(0, match.index);
  if (code === 404 || code === 410) return { status: "not-found" };
  if (code < 200 || code >= 300) return { status: "unreachable", detail: `http ${String(code)}` };
  if (content.startsWith("%PDF")) return { status: "unreachable", detail: "pdf" };
  return { status: "ok", content };
};

export const curlFetcher =
  (runtime: Pick<Runtime, "exec" | "readText">, root: string): SourceFetcher =>
  (id) => {
    const url = urlOf(id);
    if (url === undefined) {
      if (!localSource(id)) return { status: "unreachable", detail: "outside the project" };
      const local = runtime.readText(toAbsolutePath(id, toAbsolutePath(root)));
      return local.ok ? { status: "ok", content: local.value } : { status: "not-found" };
    }
    const result = runtime.exec({
      command: "curl",
      args: [
        "-sL",
        "--max-time",
        String(FETCH_TIMEOUT_S),
        "-H",
        "Accept: text/html, text/plain",
        "-w",
        "\n%{http_code}",
        url,
      ],
      cwd: toAbsolutePath(root),
      timeoutMs: (FETCH_TIMEOUT_S + 5) * 1000,
    });
    if (!result.found) return { status: "unreachable", detail: "curl missing" };
    if (result.timedOut || result.exitCode !== 0) return { status: "unreachable", detail: "network" };
    return fromCurl(result.stdout);
  };
