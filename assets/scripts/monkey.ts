import { palette } from "./palette.ts";
import { svg } from "./svg.ts";
import type { Mood } from "./timeline.ts";

export interface Pose {
  readonly mood: Mood;
  readonly beat: number;
}

export interface Look {
  readonly headScale: number;
  readonly bodyScale: number;
  readonly headShift: number;
  readonly headphones: boolean;
  readonly longSleeves: boolean;
  readonly bounce: boolean;
  readonly gaze: { readonly x: number; readonly y: number };
  readonly fur: string;
  readonly furDark: string;
  readonly behindHead: string;
  readonly onHead: string;
  readonly mouth: string | undefined;
  readonly leftArm: string | undefined;
  readonly rightArm: string | undefined;
}

export const classicLook: Look = {
  headScale: 1,
  bodyScale: 1,
  headShift: 0,
  headphones: true,
  longSleeves: false,
  bounce: true,
  gaze: { x: 3, y: 0 },
  fur: palette.fur,
  furDark: palette.furDark,
  behindHead: "",
  onHead: "",
  mouth: undefined,
  leftArm: undefined,
  rightArm: undefined,
};

const cx = 175;
const cy = 138;
const neck = 210;
const seat = 330;

export function monkeyBody(pose: Pose, look: Look = classicLook): string {
  const lift = look.bounce ? bounce(pose) : 0;
  const body = hood() + torso() + arms(pose, look) + strings();
  const top = (look.headphones ? headphones() : "") + look.behindHead + head(pose, look) + look.onHead;
  return svg`<g transform="translate(0 ${lift})">${bodyGroup(body, look)}${headGroup(top, look)}</g>`;
}

export function neckY(look: Look): number {
  return seat - (seat - neck) * look.bodyScale;
}

function bodyGroup(content: string, look: Look): string {
  if (look.bodyScale === 1) return content;
  return svg`<g transform="translate(${cx} ${seat}) scale(${look.bodyScale}) translate(${-cx} ${-seat})">${content}</g>`;
}

function headGroup(content: string, look: Look): string {
  if (look.headScale === 1 && look.bodyScale === 1 && look.headShift === 0) return content;
  const y = neckY(look) + look.headShift;
  return svg`<g transform="translate(${cx} ${y}) scale(${look.headScale}) translate(${-cx} ${-neck})">${content}</g>`;
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
  return svg`<ellipse cx="${cx}" cy="204" rx="56" ry="20" fill="${palette.hoodieDark}"/>`;
}

function torso(): string {
  return (
    svg`<path d="M96 330C96 252 122 210 ${cx} 210C228 210 254 252 254 330Z" fill="${palette.hoodie}" stroke="${palette.hoodieDark}" stroke-width="3"/>` +
    svg`<path d="M140 296h70v22q0 6-6 6h-58q-6 0-6-6z" fill="${palette.hoodieDark}" opacity="0.55"/>`
  );
}

function arms(pose: Pose, look: Look): string {
  const [leftSleeve, rightSleeve, leftPaw, rightPaw] = armParts(pose, look);
  if (look.leftArm === undefined && look.rightArm === undefined) return leftSleeve + rightSleeve + leftPaw + rightPaw;
  return (look.leftArm ?? leftSleeve + leftPaw) + (look.rightArm ?? rightSleeve + rightPaw);
}

function armParts(pose: Pose, look: Look): readonly [string, string, string, string] {
  const hand = look.longSleeves ? cuff : paw;
  if (handsUp(pose)) {
    const up = raisedHand(pose);
    const left = svg`M122 232Q90 196 98 ${150 + (pose.beat % 4 < 2 ? 3 : 0)}`;
    const right = svg`M228 232Q262 192 ${up.x} ${up.y + 14}`;
    return [sleeve(left), sleeve(right), hand(98, 144 + (pose.beat % 4 < 2 ? 3 : 0)), hand(up.x, up.y + 8)];
  }
  const typing = pose.mood === "typing";
  const leftLift = typing && pose.beat % 3 === 0 ? -6 : 0;
  const rightLift = typing && pose.beat % 3 === 1 ? -6 : 0;
  return [
    sleeve(svg`M122 234Q100 268 112 ${296 + leftLift}`),
    sleeve(svg`M228 234Q250 268 238 ${296 + rightLift}`),
    hand(114, 302 + leftLift),
    hand(236, 302 + rightLift),
  ];
}

export function cuff(x: number, y: number): string {
  return (
    svg`<ellipse cx="${x}" cy="${y}" rx="14" ry="12" fill="${palette.hoodieDark}"/>` +
    svg`<ellipse cx="${x}" cy="${y - 1}" rx="10" ry="8" fill="${palette.hoodie}"/>`
  );
}

export function sleeve(d: string): string {
  return (
    svg`<path d="${d}" fill="none" stroke="${palette.hoodieDark}" stroke-width="24" stroke-linecap="round"/>` +
    svg`<path d="${d}" fill="none" stroke="${palette.hoodie}" stroke-width="18" stroke-linecap="round"/>`
  );
}

export function paw(x: number, y: number): string {
  return (
    svg`<ellipse cx="${x}" cy="${y}" rx="11" ry="10" fill="${palette.faceShade}"/>` +
    svg`<path d="M${x - 6} ${y - 5}v6M${x} ${y - 7}v7M${x + 6} ${y - 5}v6" stroke="${palette.fur}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`
  );
}

function strings(): string {
  return (
    svg`<path d="M165 214l-3 34M185 214l3 34" stroke="${palette.string}" stroke-width="2.4" stroke-linecap="round"/>` +
    svg`<rect x="159" y="246" width="6" height="7" rx="2" fill="${palette.string}"/>` +
    svg`<rect x="185" y="246" width="6" height="7" rx="2" fill="${palette.string}"/>`
  );
}

function headphones(): string {
  return (
    svg`<path d="M130 196Q${cx} 238 220 196" fill="none" stroke="${palette.headphone}" stroke-width="7" stroke-linecap="round"/>` +
    svg`<rect x="116" y="186" width="20" height="26" rx="8" fill="${palette.headphone}"/>` +
    svg`<rect x="214" y="186" width="20" height="26" rx="8" fill="${palette.headphone}"/>` +
    svg`<rect x="121" y="192" width="10" height="14" rx="4" fill="${palette.pad}"/>` +
    svg`<rect x="219" y="192" width="10" height="14" rx="4" fill="${palette.pad}"/>`
  );
}

function head(pose: Pose, look: Look): string {
  return (
    svg`<g>` +
    svg`<circle cx="122" cy="${cy + 2}" r="18" fill="${look.fur}"/><circle cx="122" cy="${cy + 2}" r="10" fill="${palette.faceShade}"/>` +
    svg`<circle cx="228" cy="${cy + 2}" r="18" fill="${look.fur}"/><circle cx="228" cy="${cy + 2}" r="10" fill="${palette.faceShade}"/>` +
    svg`<circle cx="${cx}" cy="${cy}" r="52" fill="${look.fur}"/>` +
    svg`<path d="M162 90Q168 74 177 87Q184 72 192 90Z" fill="${look.fur}"/>` +
    svg`<path d="M166 94Q${cx} 102 186 94" fill="none" stroke="${look.furDark}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>` +
    svg`<circle cx="157" cy="${cy - 4}" r="23" fill="${palette.face}"/><circle cx="193" cy="${cy - 4}" r="23" fill="${palette.face}"/>` +
    svg`<ellipse cx="${cx}" cy="${cy + 24}" rx="34" ry="25" fill="${palette.face}"/>` +
    svg`<ellipse cx="146" cy="${cy + 20}" rx="7" ry="4" fill="${palette.blush}" opacity="0.55"/>` +
    svg`<ellipse cx="204" cy="${cy + 20}" rx="7" ry="4" fill="${palette.blush}" opacity="0.55"/>` +
    eyes(pose, look) +
    brows(pose, look.furDark) +
    svg`<circle cx="170" cy="${cy + 15}" r="2" fill="${palette.faceShade}"/><circle cx="180" cy="${cy + 15}" r="2" fill="${palette.faceShade}"/>` +
    (look.mouth ?? mouth(pose)) +
    sweat(pose) +
    svg`</g>`
  );
}

function eyes(pose: Pose, look: Look): string {
  const y = cy - 5;
  if (pose.mood === "celebrate" || pose.mood === "pleased") {
    const arc = (x: number): string => svg`M${x - 7} ${y + 2}Q${x} ${y - 7} ${x + 7} ${y + 2}`;
    return svg`<path d="${arc(158)}${arc(192)}" fill="none" stroke="${palette.eye}" stroke-width="3.2" stroke-linecap="round"/>`;
  }
  const blink = pose.mood === "typing" && pose.beat % 29 === 11;
  if (blink) {
    return svg`<path d="M151 ${y}h14M185 ${y}h14" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
  }
  const size = pose.mood === "worried" ? 7 : 6;
  const dx = pose.mood === "typing" ? look.gaze.x : 0;
  const dy = pose.mood === "typing" ? y + look.gaze.y : y;
  return (
    svg`<circle cx="${158 + dx}" cy="${dy}" r="${size}" fill="${palette.eye}"/><circle cx="${192 + dx}" cy="${dy}" r="${size}" fill="${palette.eye}"/>` +
    svg`<circle cx="${160 + dx}" cy="${dy - 2}" r="2" fill="#ffffff"/><circle cx="${194 + dx}" cy="${dy - 2}" r="2" fill="#ffffff"/>`
  );
}

function brows(pose: Pose, furDark: string): string {
  if (pose.mood !== "worried") return "";
  return svg`<path d="M149 ${cy - 20}L165 ${cy - 24}M201 ${cy - 20}L185 ${cy - 24}" stroke="${furDark}" stroke-width="3.5" stroke-linecap="round"/>`;
}

function mouth(pose: Pose): string {
  const y = cy + 28;
  switch (pose.mood) {
    case "celebrate":
      return (
        svg`<path d="M160 ${y - 3}Q${cx} ${y - 1} 190 ${y - 3}Q188 ${y + 16} ${cx} ${y + 16}Q162 ${y + 16} 160 ${y - 3}Z" fill="${palette.eye}"/>` +
        svg`<ellipse cx="${cx}" cy="${y + 11}" rx="8" ry="4" fill="${palette.blush}"/>`
      );
    case "pleased":
      return svg`<path d="M161 ${y - 2}Q${cx} ${y + 10} 189 ${y - 2}" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
    case "worried":
      return svg`<path d="M164 ${y + 3}q4 -4 8 0t8 0t8 0" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>`;
    case "typing":
      return (
        svg`<path d="M164 ${y}Q${cx} ${y + 4} 186 ${y - 1}" fill="none" stroke="${palette.eye}" stroke-width="3" stroke-linecap="round"/>` +
        svg`<path d="M180 ${y + 1}q3 7 8 3q1 -4 -2 -6z" fill="${palette.blush}"/>`
      );
  }
}

function sweat(pose: Pose): string {
  if (pose.mood !== "worried") return "";
  return svg`<path d="M222 98q-7 10 0 13q7 -3 0 -13z" fill="${palette.sweat}"/>`;
}
