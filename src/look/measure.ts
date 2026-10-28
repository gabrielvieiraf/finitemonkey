import { isRecord } from "../core/parsed.js";

export interface PageMeasure {
  readonly overflow: number;
  readonly keys: readonly string[];
  readonly small: readonly string[];
  readonly broken: readonly string[];
  readonly text?: string;
  readonly structure?: readonly string[];
}

interface MiniNode {
  readonly textContent: string | null;
}

interface MiniElement extends MiniNode {
  readonly tagName: string;
  readonly getBoundingClientRect: () => { readonly width: number; readonly height: number };
}

interface MiniImage {
  readonly complete: boolean;
  readonly naturalWidth: number;
  readonly getAttribute: (name: string) => string | null;
}

export interface MiniDocument {
  readonly body: unknown;
  readonly documentElement: { readonly scrollWidth: number; readonly clientWidth: number };
  readonly images: Iterable<MiniImage>;
  readonly createTreeWalker: (root: unknown, filter: number) => { readonly nextNode: () => MiniNode | null };
  readonly querySelectorAll: (selector: string) => Iterable<MiniElement>;
}

export const measurePage = (doc: MiniDocument): PageMeasure => {
  const KEY = /^[a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)+$/;
  const PLACEHOLDER = /\{\{\s*[\w.]+\s*\}\}|\$t\(/;
  const NOT_KEY = /\.(?:com|net|org|io|dev|br|app|js|ts|json|png|svg|jpg|md)$/i;
  const SHOW_TEXT = 4;
  const MAX_TEXT = 20000;
  const MAX_STRUCTURE = 200;
  const LAYOUT = "header, nav, main, section, article, aside, footer, form, table, h1, h2, h3, ul, ol";
  const walker = doc.createTreeWalker(doc.body, SHOW_TEXT);
  const keys = new Set<string>();
  const seen: string[] = [];
  let length = 0;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if ((KEY.test(text) && !NOT_KEY.test(text)) || PLACEHOLDER.test(text)) keys.add(text.slice(0, 80));
    if (text !== "" && length < MAX_TEXT) {
      seen.push(text);
      length += text.length + 1;
    }
  }
  const structure = [...doc.querySelectorAll(LAYOUT)]
    .slice(0, MAX_STRUCTURE)
    .map((element) => element.tagName.toLowerCase());
  const small = [...doc.querySelectorAll("a, button, input, select, textarea, [role=button], [role=link]")]
    .filter((element) => {
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && (box.width < 40 || box.height < 40);
    })
    .map((element) => `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 40)}"`);
  const broken = [...doc.images]
    .filter((image) => image.complete && image.naturalWidth === 0 && image.getAttribute("src") !== null)
    .map((image) => image.getAttribute("src") ?? "");
  const root = doc.documentElement;
  return {
    overflow: Math.max(0, root.scrollWidth - root.clientWidth),
    keys: [...keys],
    small,
    broken,
    text: seen.join("\n").slice(0, MAX_TEXT),
    structure,
  };
};

export const MEASURE_SCRIPT = `(${measurePage.toString()})(document)`;

const texts = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export const parseMeasure = (value: unknown): PageMeasure | undefined => {
  if (!isRecord(value) || typeof value["overflow"] !== "number") return undefined;
  return {
    overflow: value["overflow"],
    keys: texts(value["keys"]),
    small: texts(value["small"]),
    broken: texts(value["broken"]),
    text: typeof value["text"] === "string" ? value["text"] : "",
    structure: texts(value["structure"]),
  };
};
