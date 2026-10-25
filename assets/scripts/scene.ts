import { monkeyBody, raisedHand } from "./monkey.ts";
import { palette } from "./palette.ts";
import { desk, laptop, mouseInHand, mouseOnDesk, mug } from "./props.ts";
import { seeded } from "./random.ts";
import { terminal } from "./terminal.ts";
import { text } from "./text.ts";
import type { Frame } from "./timeline.ts";

export const width = 720;
export const height = 400;

export function scene(frame: Frame): string {
  const pose = { mood: frame.mood, beat: frame.beat };
  const celebrating = frame.mood === "celebrate";
  const hand = raisedHand(pose);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    defs() +
    `<g clip-path="url(#card)">` +
    `<rect width="${width}" height="${height}" fill="url(#wall)"/>` +
    `<ellipse cx="528" cy="170" rx="260" ry="170" fill="url(#glow)" opacity="${celebrating ? 0.32 : 0.12}"/>` +
    monkeyBody(pose) +
    desk() +
    laptop() +
    mug(frame.beat) +
    (celebrating ? mouseInHand(hand.x, hand.y) : mouseOnDesk()) +
    particles(frame) +
    (celebrating ? confetti(frame.beat) : "") +
    terminal(frame) +
    `</g></svg>`;
}

function defs(): string {
  return `<defs>` +
    `<clipPath id="card"><rect width="${width}" height="${height}" rx="24"/></clipPath>` +
    `<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${palette.cardTop}"/><stop offset="1" stop-color="${palette.cardBottom}"/></linearGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="${palette.glow}"/><stop offset="1" stop-color="${palette.glow}" stop-opacity="0"/></radialGradient>` +
    `</defs>`;
}

function particles(frame: Frame): string {
  return frame.particles.map((particle) => text(particle.char, particle.x, particle.y, 1.5, palette.text, Math.round(particle.opacity * 100) / 100)).join("");
}

function confetti(beat: number): string {
  const random = seeded(7);
  const colors = [palette.green, palette.amber, palette.blush, palette.hoodieLight, palette.banana];
  return Array.from({ length: 16 }, (_, index) => {
    const x = 70 + random() * 220;
    const fall = (random() * 120 + beat * (3 + random() * 3)) % 150;
    const y = 30 + fall;
    const color = colors[index % colors.length] ?? palette.green;
    if (Math.hypot(x - 175, y - 140) < 62) return "";
    const angle = (beat * 25 + index * 40) % 360;
    return `<rect x="-3" y="-2" width="6" height="4" fill="${color}" transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${angle})"/>`;
  }).join("");
}
