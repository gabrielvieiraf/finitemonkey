import type { HostEntry, SourceFile } from "./types.js";

const USER_AT_HOST = /\b(?:ssh|scp|rsync)\b[^\n]*?\s["']?([\w.-]+)@([A-Za-z0-9][\w.-]*)/g;
const HOST_KEY =
  /^\s*-?\s*(?:host|hostname|server|ssh_host|deploy_host|remote_host)\s*:\s*["']?([A-Za-z0-9][\w.-]*)["']?\s*$/gim;
const IPV4 = /\b((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})\b/g;
const LOCAL = /^(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0)$/i;
const HOSTLIKE = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)$/;

interface Found {
  readonly host: string;
  readonly user?: string;
  readonly file: string;
  readonly line: number;
}

const lineOf = (text: string, index: number): number => text.slice(0, index).split("\n").length;

const usable = (host: string): boolean => HOSTLIKE.test(host) && !LOCAL.test(host) && !/^\d+\.\d+$/.test(host);

const foundIn = (file: SourceFile): readonly Found[] => {
  const at = (index: number): number => lineOf(file.text, index);
  const withUser = [...file.text.matchAll(USER_AT_HOST)].map((match): Found => ({
    host: match[2] ?? "",
    user: match[1] ?? "",
    file: file.path,
    line: at(match.index),
  }));
  const keyed = [...file.text.matchAll(HOST_KEY)].map((match): Found => ({
    host: match[1] ?? "",
    file: file.path,
    line: at(match.index),
  }));
  const ips = [...file.text.matchAll(IPV4)].map((match): Found => ({
    host: match[1] ?? "",
    file: file.path,
    line: at(match.index),
  }));
  return [...withUser, ...keyed, ...ips].filter((found) => usable(found.host));
};

export const findHosts = (files: readonly SourceFile[]): readonly Found[] => files.flatMap(foundIn);

export const aliasHosts = (found: readonly Found[], existing: readonly HostEntry[] = []): readonly HostEntry[] => {
  const entries = [...existing];
  const known = new Map(existing.map((entry) => [entry.host.toLowerCase(), entry]));
  let next = existing.length;
  for (const item of found) {
    const key = item.host.toLowerCase();
    if (known.has(key)) continue;
    next += 1;
    const entry: HostEntry = {
      alias: `prod-${String(next)}`,
      host: item.host,
      ...(item.user === undefined || item.user === "" || item.user.includes("$") ? {} : { user: item.user }),
      file: item.file,
      line: item.line,
    };
    entries.push(entry);
    known.set(key, entry);
  }
  return entries;
};

export const aliasFor = (hosts: readonly HostEntry[], host: string): string | undefined =>
  hosts.find((entry) => entry.host.toLowerCase() === host.toLowerCase())?.alias;
