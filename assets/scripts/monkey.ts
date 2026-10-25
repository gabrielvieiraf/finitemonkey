import { palette } from "./palette.ts";
import type { Mood } from "./timeline.ts";

export interface Pose {
  readonly mood: Mood;
  readonly beat: number;
}

const cx = 175;
const cy = 138;

export function monkeyBody(pose: Pose): string {
  const lift = bounce(pose);
  return `<g transform="translate(0 ${lift})">${hood()}${torso()}${arms(pose)}${strings()}${headphones()}${head(pose)}</g>`;
}

export function bounce(pose: Pose): number {
  if (pose.mood === "celebrate") return pose.beat % 4 < 2 ? -7 : 0;
  return 0;
}

export function handsUp(pose: Pose): boolean {
  return pose.mood === "celebrate";
}

export function raisedHand(pose: Pose): { readonly x: number; readonly y: number } {
  return { x: 256, y: 128 + bounce(pose) + (pose.beat % 4 < 2 ? -3 : 0) };
}

function hood(): string {
  return `<ellipse cx="${cx}" cy="204" rx="56" ry="20" fill="${palette.hoodieDark}"/>`;
}

function torso(): string {
  return `<path d="M96 330C96 252 122 210 ${cx} 210C228 210 254 252 254 330Z" fill="${palette.hoodie}" stroke="${palette.hoodieDark}" stroke-width="3"/>` +
    `<path d="M140 296h70v22q0 6-6 6h-58q-6 0-6-6z" fill="${palette.hoodieDark}" opacity="0.55"/>`;
}

function arms(pose: Pose): string {
  if (handsUp(pose)) {
    const hand = raisedHand(pose);
    const left = `M122 232Q90 196 98 ${150 + (pose.beat % 4 < 2 ? 3 : 0)}`;
    const right = `M228 232Q262 192 ${hand.x} ${hand.y + 14}`;
    return sleeve(left) + sleeve(right) +
      paw(98, 144 + (pose.beat % 4 < 2 ? 3 : 0)) + paw(hand.x, hand.y + 8);
  }
  const typing = pose.mood === "typing";
  const leftLift = typing && pose.beat % 3 === 0 ? -6 : 0;
  const rightLift = typing && pose.beat % 3 === 1 ? -6 : 0;
  return sleeve(`M122 234Q100 268 112 ${296 + leftLift}`) +
    sleeve(`M228 234Q250 268 238 ${296 + rightLift}`) +
    paw(114, 302 + leftLift) + paw(236, 302 + rightLift);
}

function sleeve(d: string): string {
  return `<path d="${d}" fill="none" stroke="${palette.hoodieDark}" stroke-width="24" stroke-linecap="round"/>` +
    `<path d="${d}" fill="none" stroke="${palette.hoodie}" stroke-width="18" stroke-linecap="round"/>`;
}

function paw(x: number, y: number): string {
  return `<ellipse cx="${x}" cy="${y}" rx="11" ry="10" fill="${palette.faceShade}"/>` +
    `<path d="M${x - 6} ${y - 5}v6M${x} ${y - 7}v7M${x + 6} ${y - 5}v6" stroke="${palette.fur}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`;
}

function strings(): string {
  return `<path d="M165 214l-3 34M185 214l3 34" stroke="${palette.string}" stroke-width="2.4" stroke-linecap="round"/>` +
    `<rect x="159" y="246" width="6" height="7" rx="2" fill="${palette.string}"/>` +
    `<rect x="185" y="246" width="6" height="7" rx="2" fill="${palette.string}"/>`;
}

function headphones(): string {
  return `<path d="M130 196Q${cx} 238 220 196" fill="none" stroke="${palette.headphone}" stroke-width="7" stroke-linecap="round"/>` +
    `<rect x="116" y="186" width="20" height="26" rx="8" fill="${palette.headphone}"/>` +
    `<rect x="214" y="186" width="20" height="26" rx="8" fill="${palette.headphone}"/>` +
    `<rect x="121" y="192" width="10" height="14" rx="4" fill="${palette.pad}"/>` +
    `<rect x="219" y="192" width="10" height="14" rx="4" fill="${palette.pad}"/>`;
}

function head(pose: Pose): string {
  return `<g>` +
    `<circle cx="122" cy="${cy + 2}" r="18" fill="${palette.fur}"/><circle cx="122" cy="${cy + 2}" r="10" fill="${palette.faceShade}"/>` +
    `<circle cx="228" cy="${cy + 2}" r="18" fill="${palette.fur}"/><circle cx="228" cy="${cy + 2}" r="10" fill="${palette.faceShade}"/>` +
    `<circle cx="${cx}" cy="${cy}" r="52" fill="${palette.fur}"/>` +
    `<path d="M162 90Q168 74 177 87Q184 72 192 90Z" fill="${palette.fur}"/>` +
    `<path d="M166 94Q${cx} 102 186 94" fill="none" stroke="${palette.furDark}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>` +
    `<circle cx="157" cy="${cy - 4}" r="23" fill="${palette.face}"/><circle cx="193" cy="${cy - 4}" r="23" fill="${palette.face}"/>` +
    `<ellipse cx="${cx}" cy="${cy + 24}" rx="34" ry="25" fill="${palette.face}"/>` +
    `<ellipse cx="146" cy="${cy + 20}" rx="7" ry="4" fill="${palette.blush}" opacity="0.55"/>` +
    `<ellipse cx="204" cy="${cy + 20}" rx="7" ry="4" fill="${palette.blush}" opacity="0.55"/>` +
    eyes(pose) + brows(pose) +
    `<circle cx="170" cy="${cy + 15}" r="2" fill="${palette.faceShade}"/><circle cx="180" cy="${cy + 15}" r="2" fill="${palette.faceShade}"/>` +
    mouth(pose) + sweat(pose) +
    `</g>`;
}

function eyes(pose: Pose): string {
  const y = cy - 5;
  if (pose.mood === "celebrate" || pose.mood === "pleased") {
    const arc = (x: number): string => `M${x - 7} ${y + 2}Q${x} ${y - 7} ${x + 7} ${y + 2}`;
    return `<path d="${arc(158)}${arc(192)}" fill="none" stroke="${palette.eye}" stroke-width="3.2" stroke-linecap="round"/>`;
  }
  const blink = pose.mood === "typing" && pose.beat % 29 === 11;
  if (blink) {
    return `<path d="M151 ${y}h14M185 ${y}h14" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const size = pose.mood === "worried" ? 7 : 6;
  const look = pose.mood === "typing" ? 3 : 0;
  return `<circle cx="${158 + look}" cy="${y}" r="${size}" fill="${palette.eye}"/><circle cx="${192 + look}" cy="${y}" r="${size}" fill="${palette.eye}"/>` +
    `<circle cx="${160 + look}" cy="${y - 2}" r="2" fill="#ffffff"/><circle cx="${194 + look}" cy="${y - 2}" r="2" fill="#ffffff"/>`;
}

function brows(pose: Pose): string {
  if (pose.mood !== "worried") return "";
  return `<path d="M149 ${cy - 20}L165 ${cy - 24}M201 ${cy - 20}L185 ${cy - 24}" stroke="${palette.furDark}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function mouth(pose: Pose): string {
  const y = cy + 28;
  switch (pose.mood) {
    case "celebrate":
      return `<path d="M160 ${y - 3}Q${cx} ${y - 1} 190 ${y - 3}Q188 ${y + 16} ${cx} ${y + 16}Q162 ${y + 16} 160 ${y - 3}Z" fill="${palette.eye}"/>` +
        `<ellipse cx="${cx}" cy="${y + 11}" rx="8" ry="4" fill="${palette.blush}"/>`;
    case "pleased":
      return `<path d="M161 ${y - 2}Q${cx} ${y + 10} 189 ${y - 2}" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
    case "worried":
      return `<path d="M164 ${y + 3}q4 -4 8 0t8 0t8 0" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
    case "typing":
      return `<path d="M164 ${y}Q${cx} ${y + 4} 186 ${y - 1}" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>` +
        `<path d="M180 ${y + 1}q3 7 8 3q1 -4 -2 -6z" fill="${palette.blush}"/>`;
  }
}

function sweat(pose: Pose): string {
  if (pose.mood !== "worried") return "";
  return `<path d="M222 98q-7 10 0 13q7 -3 0 -13z" fill="${palette.sweat}"/>`;
}
