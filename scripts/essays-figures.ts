import { escapeHtml } from "./essays-markdown.js";
import { place, type Plan } from "./essays-plan.js";
import { RICOCHET_PLANS } from "./essays-plans-ricochet.js";
import { SECOND_BRAIN_PLANS } from "./essays-plans-second-brain.js";
import { annotate, parseSvg, prefixIds, serialize } from "./essays-svg.js";

const PLANS: Readonly<Record<string, Readonly<Record<string, Plan>>>> = {
  ricochet: RICOCHET_PLANS,
  "second-brain": SECOND_BRAIN_PLANS,
};

const nameOf = (file: string): string => file.replace(/^.*\//, "").replace(/\.svg$/, "");

function planFor(slug: string, file: string): Plan {
  const plan = PLANS[slug]?.[nameOf(file)];
  if (!plan) throw new Error(`no motion plan for ${slug}/${file}`);
  return plan;
}

export function inlineFigure(slug: string, file: string, raw: string, alt: string): string {
  const name = nameOf(file);
  const prefix = `${slug}-${name}-`;
  const svg = parseSvg(raw);
  const placed = place(planFor(slug, file), svg.items, prefix, `${slug}/${file}`);
  const open = svg.open
    .replace(/\saria-label="[^"]*"/, ` aria-label="${escapeHtml(alt)}"`)
    .replace(/^<svg\b/, `<svg class="fig-svg" data-fig="${prefix.slice(0, -1)}"`);
  const body = placed.map((p) => (p.motion ? annotate(p.item, p.motion) : p.item.raw));
  return prefixIds(serialize({ ...svg, open }, body), prefix);
}

export function standaloneFigure(slug: string, file: string, raw: string): string | null {
  const plan = planFor(slug, file);
  if (!plan.redraw) return null;
  const svg = parseSvg(raw);
  const placed = place(plan, svg.items, "", `${slug}/${file}`);
  return serialize(
    svg,
    placed.map((p) => p.item.raw),
  );
}
