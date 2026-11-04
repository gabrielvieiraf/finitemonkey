const SHARED: readonly RegExp[] = [
  /^:root/,
  /^@media \(prefers-color-scheme/,
  /^@media \(prefers-reduced-motion/,
  /^@keyframes brand-/,
  /^\*$/,
  /^body$/,
  /^html$/,
  /^a(?::|$|,)/,
  /^\.(?:page|bar|brand|tag|nav|seg)\b/,
  /^footer\b/,
  /^\.traj\b/,
];

interface Rule {
  readonly prelude: string;
  readonly text: string;
}

function topLevelRules(css: string): Rule[] {
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === "{") depth++;
    if (c !== "}") continue;
    depth--;
    if (depth !== 0) continue;
    const text = css.slice(start, i + 1).trim();
    rules.push({ prelude: text.slice(0, text.indexOf("{")).trim(), text });
    start = i + 1;
  }
  return rules;
}

export function siteCss(indexHtml: string): string {
  const style = /<style>([\s\S]*?)<\/style>/.exec(indexHtml)?.[1] ?? "";
  return topLevelRules(style)
    .filter((rule) => SHARED.some((pattern) => pattern.test(rule.prelude)))
    .map((rule) => rule.text)
    .join("\n");
}
