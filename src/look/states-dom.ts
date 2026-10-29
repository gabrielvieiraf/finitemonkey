import type { Kit, MiniDoc, MiniEl } from "./probe-dom.js";

interface MiniRecord {
  readonly target: MiniEl | { readonly nodeType: number; readonly parentElement: MiniEl | null };
}

interface MiniObserver {
  readonly observe: (
    node: MiniEl,
    options: { readonly subtree: boolean; readonly characterData: boolean; readonly childList: boolean },
  ) => void;
  readonly disconnect: () => void;
}

export interface WatchWin {
  readonly MutationObserver: new (callback: (records: readonly MiniRecord[]) => void) => MiniObserver;
  readonly setTimeout: (callback: () => void, ms: number) => number;
}

export const LIVE_SELECTOR =
  "[aria-live=polite], [aria-live=assertive], [role=status], [role=alert], [role=log], [role=timer], [role=marquee], [role=progressbar], output";

export const watchText = (
  kit: Kit,
  doc: MiniDoc,
  win: WatchWin,
  ms: number,
  lives: string,
): Promise<readonly string[]> =>
  new Promise((resolve) => {
    const changed = new Set<string>();
    const observer = new win.MutationObserver((records) => {
      for (const record of records) {
        const target = "tagName" in record.target ? record.target : record.target.parentElement;
        if (target === null) continue;
        if (target.closest(lives) !== null) continue;
        if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(target.tagName) || kit.clean(target.textContent) === "") continue;
        changed.add(kit.selectorOf(target));
      }
    });
    observer.observe(doc.body, { subtree: true, characterData: true, childList: true });
    win.setTimeout(() => {
      observer.disconnect();
      resolve([...changed].slice(0, 20));
    }, ms);
  });

export const hasIndicator = (_kit: Kit, doc: MiniDoc, skeleton: string): boolean => {
  const query = `[role=progressbar], [aria-busy=true], progress${skeleton === "" ? "" : `, ${skeleton}`}`;
  return [...doc.querySelectorAll(query)].some((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0;
  });
};
