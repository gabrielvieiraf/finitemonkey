import type { Kit, MiniDoc, MiniEl, MiniStyle } from "./probe-dom.js";

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

export interface ShimmerWin {
  readonly getComputedStyle: (element: MiniEl, pseudo?: string) => MiniStyle;
  readonly scrollX: number;
  readonly scrollY: number;
}

export interface ShimmerBlock {
  readonly sel: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export const shimmerBlocks = (kit: Kit, doc: MiniDoc, win: ShimmerWin, marked: string): readonly ShimmerBlock[] => {
  const skip = ["script", "style", "svg", "img", "video", "canvas", "input", "textarea", "select", "iframe"];
  const painted = (style: MiniStyle): boolean => {
    const name = style.getPropertyValue("animation-name");
    const image = style.getPropertyValue("background-image");
    const color = style.getPropertyValue("background-color").replace(/\s/g, "");
    const filled =
      (image !== "" && image !== "none") || (color !== "" && color !== "transparent" && color !== "rgba(0,0,0,0)");
    return name !== "" && name !== "none" && filled;
  };
  const found = new Set<MiniEl>();
  const out: ShimmerBlock[] = [];
  for (const element of doc.querySelectorAll("body *")) {
    if (out.length >= 20) break;
    if (skip.includes(element.tagName.toLowerCase()) || kit.clean(element.textContent) !== "") continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 16 || rect.height < 8 || element.closest(marked) !== null) continue;
    const styles = [
      win.getComputedStyle(element),
      win.getComputedStyle(element, "::before"),
      win.getComputedStyle(element, "::after"),
    ];
    if (!styles.some(painted)) continue;
    let inside = false;
    for (let node = element.parentElement; node !== null && !inside; node = node.parentElement)
      inside = found.has(node);
    if (inside) continue;
    found.add(element);
    out.push({
      sel: kit.selectorOf(element),
      x: rect.x + win.scrollX,
      y: rect.y + win.scrollY,
      w: rect.width,
      h: rect.height,
    });
  }
  return out;
};
