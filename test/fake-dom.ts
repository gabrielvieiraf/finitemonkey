import type { Kit, MiniEl, MiniRect, MiniStyle } from "../src/look/probe-dom.js";
import {
  clean,
  describe as describeNode,
  labelText,
  nameOf,
  ownText,
  px,
  roleOf,
  selectorOf,
  styleOf,
} from "../src/look/probe-dom.js";

export const kit: Kit = { clean, px, selectorOf, roleOf, labelText, nameOf, ownText, styleOf, describe: describeNode };

type Style = Readonly<Record<string, string>>;

export interface Spec {
  readonly attrs?: Readonly<Record<string, string>>;
  readonly style?: Style;
  readonly pseudo?: Readonly<Record<string, Style>>;
  readonly rect?: MiniRect;
}

type Child = FakeEl | string;

const compoundMatches = (element: FakeEl, compound: string): boolean => {
  const tag = /^[a-z*][\w-]*/i.exec(compound)?.[0] ?? "*";
  if (tag !== "*" && tag.toLowerCase() !== element.tagName.toLowerCase()) return false;
  const id = /#([\w-]+)/.exec(compound)?.[1];
  if (id !== undefined && element.id !== id) return false;
  return [...compound.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)].every(([, name = "", value]) =>
    value === undefined ? element.hasAttribute(name) : element.getAttribute(name) === value,
  );
};

const chainMatches = (element: FakeEl | null, parts: readonly string[], child: boolean): boolean => {
  const last = parts[parts.length - 1];
  if (last === undefined) return true;
  if (last === ">") return chainMatches(element, parts.slice(0, -1), true);
  for (let node = element; node !== null; node = child ? null : node.parentElement)
    if (compoundMatches(node, last) && chainMatches(node.parentElement, parts.slice(0, -1), false)) return true;
  return false;
};

const complexMatches = (element: FakeEl, selector: string): boolean => {
  const parts = selector.trim().split(/\s+/);
  const last = parts.pop();
  return last !== undefined && compoundMatches(element, last) && chainMatches(element.parentElement, parts, false);
};

export class FakeEl {
  readonly tagName: string;
  readonly id: string;
  parentElement: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  readonly childNodes: { readonly nodeType: number; readonly textContent: string | null }[] = [];
  readonly nodeType = 1;
  readonly scrollWidth = 0;
  readonly clientWidth = 0;
  readonly spec: Spec;
  value: string;

  constructor(tag: string, spec: Spec, kids: readonly Child[]) {
    this.tagName = tag.toUpperCase();
    this.spec = spec;
    this.id = spec.attrs?.["id"] ?? "";
    this.value = spec.attrs?.["value"] ?? "";
    for (const kid of kids) {
      if (typeof kid === "string") this.childNodes.push({ nodeType: 3, textContent: kid });
      else {
        kid.parentElement = this;
        this.children.push(kid);
        this.childNodes.push(kid);
      }
    }
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent ?? "").join("");
  }

  getAttribute(name: string): string | null {
    return this.spec.attrs?.[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.spec.attrs?.[name] !== undefined;
  }

  getBoundingClientRect(): MiniRect {
    return this.spec.rect ?? { x: 0, y: 0, width: 100, height: 20 };
  }

  matches(selector: string): boolean {
    return selector.split(",").some((part) => complexMatches(this, part));
  }

  closest(selector: string): FakeEl | null {
    return this.matches(selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }

  descendants(): readonly FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.descendants()]);
  }

  querySelectorAll(selector: string): readonly FakeEl[] {
    return this.descendants().filter((node) => node.matches(selector));
  }

  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

export const el = (tag: string, spec: Spec = {}, ...kids: readonly Child[]): FakeEl => new FakeEl(tag, spec, kids);

export interface FakeDom {
  readonly doc: {
    readonly body: FakeEl;
    readonly documentElement: FakeEl;
    readonly activeElement: null;
    readonly getElementById: (id: string) => FakeEl | null;
    readonly querySelectorAll: (selector: string) => readonly FakeEl[];
    readonly querySelector: (selector: string) => FakeEl | null;
  };
  readonly win: {
    readonly scrollX: number;
    readonly scrollY: number;
    readonly getComputedStyle: (node: MiniEl, pseudo?: string) => MiniStyle;
  };
}

export const fakeDom = (bodyKids: readonly FakeEl[], lang = "en"): FakeDom => {
  const body = el("body", {}, ...bodyKids);
  const html = el("html", { attrs: { lang } }, body);
  const doc = {
    body,
    documentElement: html,
    activeElement: null,
    getElementById: (id: string) => html.descendants().find((node) => node.id === id) ?? null,
    querySelectorAll: (selector: string) => html.querySelectorAll(selector),
    querySelector: (selector: string) => html.querySelector(selector),
  };
  const style = (values: Style | undefined): MiniStyle => ({ getPropertyValue: (name) => values?.[name] ?? "" });
  const win = {
    scrollX: 0,
    scrollY: 0,
    getComputedStyle: (node: MiniEl, pseudo?: string): MiniStyle =>
      node instanceof FakeEl ? style(pseudo === undefined ? node.spec.style : node.spec.pseudo?.[pseudo]) : style({}),
  };
  return { doc, win };
};
