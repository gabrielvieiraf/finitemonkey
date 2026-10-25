import { palette } from "../palette.ts";
import { svg } from "../svg.ts";
import { text } from "../text.ts";
import { ink } from "./kit.ts";

export interface Agent {
  readonly x: number;
  readonly facing: number;
  readonly stride: number;
  readonly sitting: boolean;
  readonly taut: number;
  readonly check: boolean;
}

const ground = 334;
export const agentScale = 1.35;

export function agent(one: Agent): string {
  const lift = one.sitting ? 6 : 0;
  const swing = one.stride === 0 ? 4 : -4;
  const legs = one.sitting
    ? svg`<path d="M-6 -6h10M2 -6h10" stroke="${palette.furDark}" stroke-width="3.5" stroke-linecap="round"/>`
    : svg`<path d="M-3 -8L${-3 - swing} 0M3 -8L${3 + swing} 0" stroke="${palette.furDark}" stroke-width="3.5" stroke-linecap="round"/>`;
  return (
    svg`<g transform="translate(${one.x} ${ground}) scale(${one.facing * agentScale} ${agentScale})">` +
    legs +
    svg`<g transform="translate(0 ${lift})">` +
    svg`<ellipse cx="0" cy="-15" rx="10" ry="9" fill="${ink.teal}" stroke="${ink.tealDark}" stroke-width="2"/>` +
    svg`<path d="M5 -16L11 -14" stroke="${ink.teal}" stroke-width="5" stroke-linecap="round"/>` +
    svg`<circle cx="-8" cy="-30" r="3.5" fill="${palette.fur}"/><circle cx="8" cy="-30" r="3.5" fill="${palette.fur}"/>` +
    svg`<circle cx="0" cy="-30" r="9" fill="${palette.fur}"/>` +
    svg`<ellipse cx="1.5" cy="-28" rx="6.5" ry="5" fill="${palette.face}"/>` +
    svg`<circle cx="-1" cy="-30" r="1.5" fill="${palette.eye}"/><circle cx="4" cy="-30" r="1.5" fill="${palette.eye}"/>` +
    svg`</g>` +
    svg`</g>` +
    (one.check ? text("✓", one.x - 6, ground - 62, 2, palette.green) : "")
  );
}
