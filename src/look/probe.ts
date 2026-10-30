import { isRecord } from "../core/parsed.js";
import { probePage, runInPage } from "./probe-dom.js";

export interface ProbeBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ProbeNode extends ProbeBox {
  readonly parent: number;
  readonly sel: string;
  readonly tag: string;
  readonly role: string;
  readonly name: string;
  readonly text: string;
  readonly visible: boolean;
  readonly interactive: boolean;
  readonly field: boolean;
  readonly labelled: boolean;
  readonly placeholder: string;
  readonly inline: boolean;
  readonly native: boolean;
  readonly alt: string | null;
  readonly color: string;
  readonly bg: string;
  readonly bgImage: string;
  readonly opacity: number;
  readonly fontSize: number;
  readonly fontWeight: number;
  readonly fontFamily: string;
  readonly lineHeight: number;
  readonly radius: number;
  readonly shadow: string;
  readonly borderColor: string;
  readonly borderWidth: number;
  readonly spacing: readonly number[];
  readonly position: string;
  readonly clipped: boolean;
  readonly live: boolean;
}

export interface ProbeResult {
  readonly scrollWidth: number;
  readonly clientWidth: number;
  readonly lang: string;
  readonly truncated: boolean;
  readonly nodes: readonly ProbeNode[];
}

export const PROBE_LIMIT = 3000;

export const PROBE_SCRIPT = runInPage(probePage.toString(), ["document", "window", String(PROBE_LIMIT)]);

const SPACING_FIELDS = 10;

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const bool = (value: unknown): boolean => value === true;

const parseNode = (value: unknown): ProbeNode | undefined => {
  if (!isRecord(value) || typeof value["sel"] !== "string") return undefined;
  const spacing = Array.isArray(value["spacing"]) ? value["spacing"].map(num) : [];
  return {
    parent: typeof value["parent"] === "number" ? value["parent"] : -1,
    sel: value["sel"],
    tag: str(value["tag"]),
    role: str(value["role"]),
    name: str(value["name"]),
    text: str(value["text"]),
    visible: bool(value["visible"]),
    interactive: bool(value["interactive"]),
    field: bool(value["field"]),
    labelled: value["labelled"] !== false,
    placeholder: str(value["placeholder"]),
    inline: bool(value["inline"]),
    native: bool(value["native"]),
    alt: typeof value["alt"] === "string" ? value["alt"] : null,
    x: num(value["x"]),
    y: num(value["y"]),
    w: num(value["w"]),
    h: num(value["h"]),
    color: str(value["color"]),
    bg: str(value["bg"]),
    bgImage: str(value["bgImage"]),
    opacity: typeof value["opacity"] === "number" ? value["opacity"] : 1,
    fontSize: num(value["fontSize"]),
    fontWeight: num(value["fontWeight"]),
    fontFamily: str(value["fontFamily"]),
    lineHeight: num(value["lineHeight"]),
    radius: num(value["radius"]),
    shadow: str(value["shadow"]),
    borderColor: str(value["borderColor"]),
    borderWidth: num(value["borderWidth"]),
    spacing: spacing.length === SPACING_FIELDS ? spacing : new Array<number>(SPACING_FIELDS).fill(0),
    position: str(value["position"]),
    clipped: bool(value["clipped"]),
    live: bool(value["live"]),
  };
};

export const parseProbe = (value: unknown): ProbeResult | undefined => {
  if (!isRecord(value) || !Array.isArray(value["nodes"])) return undefined;
  return {
    scrollWidth: num(value["scrollWidth"]),
    clientWidth: num(value["clientWidth"]),
    lang: str(value["lang"]),
    truncated: bool(value["truncated"]),
    nodes: value["nodes"].flatMap((item: unknown) => parseNode(item) ?? []),
  };
};
