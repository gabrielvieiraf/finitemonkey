import { palette } from "./palette.ts";
import { text } from "./text.ts";

export const deskY = 322;

export function desk(): string {
  return `<rect x="0" y="${deskY}" width="720" height="14" fill="${palette.deskTop}"/>` +
    `<rect x="0" y="${deskY + 14}" width="720" height="80" fill="${palette.deskFront}"/>` +
    `<path d="M0 ${deskY + 14}h720" stroke="${palette.deskLine}" stroke-width="3"/>`;
}

export function laptop(): string {
  return `<rect x="104" y="${deskY - 6}" width="142" height="7" rx="3" fill="${palette.laptopDeck}"/>` +
    `<rect x="116" y="232" width="118" height="${deskY - 4 - 232}" rx="8" fill="${palette.laptop}"/>` +
    `<rect x="116" y="232" width="118" height="${deskY - 4 - 232}" rx="8" fill="none" stroke="${palette.laptopEdge}" stroke-width="2"/>` +
    banana(152, 284, -18, 0.9) +
    stickyNote(198, 256, 7);
}

export function stickyNote(x: number, y: number, angle: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle})">` +
    `<rect x="-19" y="-17" width="38" height="34" rx="2" fill="${palette.note}"/>` +
    `<rect x="-19" y="-17" width="38" height="7" rx="2" fill="${palette.mugDark}" opacity="0.3"/>` +
    text("ship", -14, -6, 1.2, palette.noteInk) +
    text("it!", -11, 5, 1.2, palette.noteInk) +
    `</g>`;
}

export function banana(x: number, y: number, angle: number, scale: number): string {
  return `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${scale})">` +
    `<path d="M-20 0Q0 22 20 -6Q0 4 -20 0Z" fill="${palette.banana}"/>` +
    `<path d="M-18 1Q0 18 18 -4" fill="none" stroke="${palette.bananaDark}" stroke-width="2" stroke-linecap="round" opacity="0.7"/>` +
    `<path d="M19 -6l5 -4" stroke="${palette.bananaTip}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<circle cx="-20" cy="0" r="2" fill="${palette.bananaTip}"/>` +
    `</g>`;
}

export function mug(beat: number): string {
  const rise = (beat % 6) * 1.5;
  const wisp = (dx: number): string => `M${272 + dx} ${290 - rise}q-5 -6 0 -12q5 -6 0 -12`;
  return `<path d="${wisp(0)}${wisp(9)}" fill="none" stroke="${palette.steam}" stroke-width="2.4" stroke-linecap="round" opacity="${0.55 - (beat % 6) * 0.06}"/>` +
    `<circle cx="292" cy="306" r="8" fill="none" stroke="${palette.mugDark}" stroke-width="5"/>` +
    `<rect x="262" y="292" width="28" height="${deskY - 292}" rx="5" fill="${palette.mug}"/>` +
    `<ellipse cx="276" cy="294" rx="12" ry="3" fill="${palette.coffee}"/>` +
    text("</>", 267, 303, 1.2, "#ffffff", 0.85);
}

export function mouseOnDesk(): string {
  return `<path d="M246 ${deskY - 2}C258 ${deskY + 2} 286 ${deskY + 6} 302 ${deskY - 2}" fill="none" stroke="${palette.cord}" stroke-width="2"/>` +
    banana(322, deskY - 7, 8, 1);
}

export function mouseInHand(x: number, y: number): string {
  return `<path d="M${x + 6} ${y + 16}C${x + 26} ${y + 50} ${x + 10} ${y + 120} 246 ${deskY - 2}" fill="none" stroke="${palette.cord}" stroke-width="2"/>` +
    banana(x + 4, y - 12, -70, 1.25) +
    `<ellipse cx="${x}" cy="${y + 8}" rx="11" ry="10" fill="${palette.faceShade}"/>` +
    `<path d="M${x - 6} ${y + 3}v6M${x} ${y + 1}v7M${x + 6} ${y + 3}v6" stroke="${palette.fur}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`;
}
