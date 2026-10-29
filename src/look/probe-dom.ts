import type { ProbeNode, ProbeResult } from "./probe.js";

export interface MiniStyle {
  readonly getPropertyValue: (name: string) => string;
}

export interface MiniRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface MiniEl {
  readonly tagName: string;
  readonly id: string;
  readonly parentElement: MiniEl | null;
  readonly children: Iterable<MiniEl>;
  readonly childNodes: Iterable<{ readonly nodeType: number; readonly textContent: string | null }>;
  readonly textContent: string | null;
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly getAttribute: (name: string) => string | null;
  readonly hasAttribute: (name: string) => boolean;
  readonly getBoundingClientRect: () => MiniRect;
  readonly closest: (selector: string) => MiniEl | null;
  readonly querySelector: (selector: string) => MiniEl | null;
}

export interface MiniDoc {
  readonly body: MiniEl;
  readonly documentElement: MiniEl;
  readonly getElementById: (id: string) => MiniEl | null;
  readonly querySelectorAll: (selector: string) => Iterable<MiniEl>;
}

export interface MiniWin {
  readonly getComputedStyle: (element: MiniEl) => MiniStyle;
  readonly scrollX: number;
  readonly scrollY: number;
}

export interface Kit {
  readonly clean: (value: string | null) => string;
  readonly px: (value: string) => number;
  readonly selectorOf: (element: MiniEl) => string;
  readonly roleOf: (kit: Kit, element: MiniEl, tag: string) => string;
  readonly labelText: (kit: Kit, doc: MiniDoc, element: MiniEl) => string;
  readonly nameOf: (kit: Kit, doc: MiniDoc, element: MiniEl, tag: string) => string;
  readonly ownText: (kit: Kit, element: MiniEl) => string;
  readonly styleOf: (kit: Kit, style: MiniStyle) => StyleFields;
  readonly describe: (kit: Kit, doc: MiniDoc, win: MiniWin, element: MiniEl, parent: number) => ProbeNode;
}

export type StyleFields = Pick<
  ProbeNode,
  | "color"
  | "bg"
  | "bgImage"
  | "opacity"
  | "fontSize"
  | "fontWeight"
  | "fontFamily"
  | "lineHeight"
  | "radius"
  | "shadow"
  | "borderColor"
  | "borderWidth"
  | "spacing"
  | "position"
>;

export const clean = (value: string | null): string => (value ?? "").replace(/\s+/g, " ").trim();

export const px = (value: string): number => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const selectorOf = (element: MiniEl): string => {
  const parts: string[] = [];
  let current: MiniEl | null = element;
  while (current !== null && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    if (current.id !== "" && /^[A-Za-z][\w-]*$/.test(current.id)) {
      parts.unshift(`#${current.id}`);
      break;
    }
    if (tag === "body" || tag === "html") {
      parts.unshift(tag);
      break;
    }
    const parent: MiniEl | null = current.parentElement;
    const same = parent === null ? [] : [...parent.children].filter((item) => item.tagName === current?.tagName);
    const position = same.indexOf(current) + 1;
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${String(position)})` : tag);
    current = parent;
  }
  return parts.join(" > ");
};

export const roleOf = (kit: Kit, element: MiniEl, tag: string): string => {
  const implicit: Readonly<Record<string, string>> = {
    button: "button",
    select: "combobox",
    textarea: "textbox",
    nav: "navigation",
    main: "main",
    header: "banner",
    footer: "contentinfo",
    form: "form",
    img: "img",
    ul: "list",
    ol: "list",
    dialog: "dialog",
  };
  const inputs: Readonly<Record<string, string>> = {
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
  };
  const explicit = kit.clean(element.getAttribute("role")).split(" ")[0] ?? "";
  if (explicit !== "") return explicit;
  if (tag === "a") return element.hasAttribute("href") ? "link" : "";
  if (tag === "input") return inputs[kit.clean(element.getAttribute("type")).toLowerCase()] ?? "textbox";
  if (/^h[1-6]$/.test(tag)) return "heading";
  return implicit[tag] ?? "";
};

export const labelText = (kit: Kit, doc: MiniDoc, element: MiniEl): string => {
  const ids = kit.clean(element.getAttribute("aria-labelledby"));
  if (ids !== "")
    return kit.clean(
      ids
        .split(" ")
        .map((id) => doc.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
  const aria = kit.clean(element.getAttribute("aria-label"));
  if (aria !== "") return aria;
  if (element.id !== "") {
    const label = [...doc.querySelectorAll("label[for]")].find((item) => item.getAttribute("for") === element.id);
    if (label !== undefined) return kit.clean(label.textContent);
  }
  const wrapping = element.closest("label");
  return wrapping === null ? "" : kit.clean(wrapping.textContent);
};

export const nameOf = (kit: Kit, doc: MiniDoc, element: MiniEl, tag: string): string => {
  const label = kit.labelText(kit, doc, element);
  if (label !== "") return label;
  const attr = (name: string): string => kit.clean(element.getAttribute(name));
  if (tag === "img") return attr("alt");
  if (tag === "input") {
    const kind = attr("type").toLowerCase();
    if (kind === "submit" || kind === "button" || kind === "reset") return attr("value");
    return kind === "image" ? attr("alt") : attr("title");
  }
  if (tag === "select" || tag === "textarea") return attr("title");
  const text = kit.clean(element.textContent);
  if (text !== "") return text.slice(0, 80);
  const image = element.querySelector("img[alt], svg[aria-label], [aria-label]");
  const fromImage = image === null ? "" : kit.clean(image.getAttribute("alt") ?? image.getAttribute("aria-label"));
  return fromImage !== "" ? fromImage : attr("title");
};

export const ownText = (kit: Kit, element: MiniEl): string =>
  kit.clean(
    [...element.childNodes]
      .filter((node) => node.nodeType === 3)
      .map((node) => node.textContent ?? "")
      .join(""),
  );

export const styleOf = (kit: Kit, style: MiniStyle): StyleFields => {
  const get = (name: string): string => style.getPropertyValue(name);
  const sides = ["top", "right", "bottom", "left"];
  return {
    color: get("color"),
    bg: get("background-color"),
    bgImage: get("background-image"),
    opacity: get("opacity") === "" ? 1 : kit.px(get("opacity")),
    fontSize: kit.px(get("font-size")),
    fontWeight: kit.px(get("font-weight")),
    fontFamily: get("font-family"),
    lineHeight: kit.px(get("line-height")),
    radius: kit.px(get("border-top-left-radius")),
    shadow: get("box-shadow"),
    borderColor: get("border-top-color"),
    borderWidth: kit.px(get("border-top-width")),
    spacing: [
      ...sides.map((side) => kit.px(get(`margin-${side}`))),
      ...sides.map((side) => kit.px(get(`padding-${side}`))),
      kit.px(get("row-gap")),
      kit.px(get("column-gap")),
    ],
    position: get("position"),
  };
};

export const describe = (kit: Kit, doc: MiniDoc, win: MiniWin, element: MiniEl, parent: number): ProbeNode => {
  const tag = element.tagName.toLowerCase();
  const style = win.getComputedStyle(element);
  const get = (name: string): string => style.getPropertyValue(name);
  const rect = element.getBoundingClientRect();
  const role = kit.roleOf(kit, element, tag);
  const kind = kit.clean(element.getAttribute("type")).toLowerCase();
  const hidden = tag === "input" && kind === "hidden";
  const shown = rect.width > 0 && rect.height > 0 && get("visibility") !== "hidden" && get("display") !== "none";
  const visible = !hidden && shown && element.closest("[aria-hidden=true]") === null;
  const field =
    ["input", "select", "textarea"].includes(tag) && !hidden && !["submit", "button", "reset", "image"].includes(kind);
  const roles = ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "option", "slider"];
  const focusable = kit.clean(element.getAttribute("tabindex")) === "0";
  const interactive = visible && !element.hasAttribute("disabled") && (roles.includes(role) || field || focusable);
  const holder = element.parentElement;
  const text = kit.ownText(kit, element);
  const overflowX = get("overflow-x");
  const lives =
    "[role=status], [role=alert], [role=log], [role=timer], [role=marquee], [role=progressbar], [aria-live=polite], [aria-live=assertive], output";
  return {
    parent,
    sel: kit.selectorOf(element),
    tag,
    role,
    name: interactive || field || tag === "img" ? kit.nameOf(kit, doc, element, tag) : "",
    text: text.slice(0, 120),
    visible,
    interactive,
    field,
    labelled: field ? kit.labelText(kit, doc, element) !== "" || kit.clean(element.getAttribute("title")) !== "" : true,
    placeholder: kit.clean(element.getAttribute("placeholder")),
    inline:
      get("display") === "inline" &&
      holder !== null &&
      kit.clean(holder.textContent).length > kit.clean(element.textContent).length + 1,
    native:
      tag === "select" || (tag === "input" && ["checkbox", "radio"].includes(kind) && get("appearance") !== "none"),
    alt: tag === "img" ? element.getAttribute("alt") : null,
    x: rect.x + win.scrollX,
    y: rect.y + win.scrollY,
    w: rect.width,
    h: rect.height,
    ...kit.styleOf(kit, style),
    clipped:
      (overflowX === "hidden" || overflowX === "clip") && text !== "" && element.scrollWidth > element.clientWidth + 1,
    live: element.closest(lives) !== null,
  };
};

export const probePage = (kit: Kit, doc: MiniDoc, win: MiniWin, limit: number): ProbeResult => {
  const elements: MiniEl[] = [];
  const index = new Map<MiniEl, number>();
  const queue: MiniEl[] = [doc.body];
  let truncated = false;
  for (let element = queue.shift(); element !== undefined; element = queue.shift()) {
    if (elements.length >= limit) {
      truncated = true;
      break;
    }
    index.set(element, elements.length);
    elements.push(element);
    queue.push(...element.children);
  }
  const nodes = elements.map((element) => {
    const holder = element.parentElement;
    return kit.describe(kit, doc, win, element, holder === null ? -1 : (index.get(holder) ?? -1));
  });
  return {
    scrollWidth: doc.documentElement.scrollWidth,
    clientWidth: doc.documentElement.clientWidth,
    lang: kit.clean(doc.documentElement.getAttribute("lang")),
    truncated,
    nodes,
  };
};

const KIT_PARTS = { clean, px, selectorOf, roleOf, labelText, nameOf, ownText, styleOf, describe } as const;

export const kitSource = (): string =>
  `{ ${Object.entries(KIT_PARTS)
    .map(([key, part]) => `${key}: ${part.toString()}`)
    .join(", ")} }`;

export const runInPage = (body: string, args: readonly string[]): string =>
  `(() => { const __name = (f) => f; const kit = ${kitSource()}; return (${body})(kit, ${args.join(", ")}); })()`;
