export const SECTION_START = "<!-- finitemonkey:prototype:start -->";
export const SECTION_END = "<!-- finitemonkey:prototype:end -->";
const READY = /(?:\bstatus:\s*ready-for-dev\b|data-status=["']ready-for-dev["']|@ready-for-dev\b)/;
const TAG = /<([A-Z][A-Za-z0-9]*)[\s/>]/g;

export interface Prototype {
  readonly path: string;
  readonly title: string;
  readonly components: readonly string[];
}

export const isReady = (text: string): boolean => READY.test(text);

const titleOf = (path: string): string => {
  const name = path.split("/").pop() ?? path;
  return `Prototype: ${name.replace(/\.[^.]+$/, "")}`;
};

export const prototypeOf = (path: string, text: string): Prototype => ({
  path,
  title: titleOf(path),
  components: [...new Set([...text.matchAll(TAG)].map((match) => match[1] ?? ""))].sort(),
});

export const sectionOf = (prototype: Prototype, heading: string, components: string): string =>
  [
    SECTION_START,
    `### ${heading}`,
    "",
    `\`${prototype.path}\``,
    "",
    components,
    ...prototype.components.map((name) => `- \`${name}\``),
    SECTION_END,
  ].join("\n");

export const replaceMarked = (body: string, section: string): string => {
  const start = body.indexOf(SECTION_START);
  const end = body.indexOf(SECTION_END, start);
  if (start === -1 || end === -1) return body === "" ? section : `${body.replace(/\n*$/, "")}\n\n${section}`;
  return `${body.slice(0, start)}${section}${body.slice(end + SECTION_END.length)}`;
};
