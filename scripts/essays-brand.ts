const FUR = "#8b5a3c";
const FUR_DARK = "#6a4029";
const FACE = "#efcfa6";
const FACE_SHADE = "#d9b184";
const EYE = "#1a1d2a";
const BLUSH = "#f19a8a";

const MARK = [
  `<svg class="brand-mark" viewBox="100 68 150 126" aria-hidden="true" focusable="false">`,
  `<g class="brand-head">`,
  `<circle cx="122" cy="140" r="18" fill="${FUR}"/><circle cx="122" cy="140" r="10" fill="${FACE_SHADE}"/>`,
  `<circle cx="228" cy="140" r="18" fill="${FUR}"/><circle cx="228" cy="140" r="10" fill="${FACE_SHADE}"/>`,
  `<circle cx="175" cy="138" r="52" fill="${FUR}"/>`,
  `<path d="M162 90Q168 74 177 87Q184 72 192 90Z" fill="${FUR}"/>`,
  `<path d="M166 94Q175 102 186 94" fill="none" stroke="${FUR_DARK}" stroke-width="2" stroke-linecap="round" opacity="0.6"/>`,
  `<circle cx="157" cy="134" r="23" fill="${FACE}"/><circle cx="193" cy="134" r="23" fill="${FACE}"/>`,
  `<ellipse cx="175" cy="162" rx="34" ry="25" fill="${FACE}"/>`,
  `<ellipse cx="146" cy="158" rx="7" ry="4" fill="${BLUSH}" opacity="0.55"/>`,
  `<ellipse cx="204" cy="158" rx="7" ry="4" fill="${BLUSH}" opacity="0.55"/>`,
  `<g class="brand-eyes"><circle cx="158" cy="133" r="6" fill="${EYE}"/><circle cx="192" cy="133" r="6" fill="${EYE}"/>`,
  `<circle cx="160" cy="131" r="2" fill="#ffffff"/><circle cx="194" cy="131" r="2" fill="#ffffff"/></g>`,
  `<circle cx="170" cy="153" r="2" fill="${FACE_SHADE}"/><circle cx="180" cy="153" r="2" fill="${FACE_SHADE}"/>`,
  `<path d="M161 164Q175 176 189 164" fill="none" stroke="${EYE}" stroke-width="3" stroke-linecap="round"/>`,
  `</g>`,
  `</svg>`,
].join("");

const letters = (word: string): string => word.replace(/./g, (c) => `<span>${c}</span>`);

export function brandLink(href: string): string {
  return `<a class="brand" href="${href}" aria-label="Finite Monkey" data-intro>${MARK}<span class="brand-word" aria-hidden="true">${letters("finite")} ${letters("monkey")}</span></a>`;
}
