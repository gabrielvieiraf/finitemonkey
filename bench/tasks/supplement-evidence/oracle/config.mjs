import { statedAsFact } from "./note.mjs";

export const SIDES = [["trial-2021-hansen.md"], ["trial-2023-okafor.md"]];
export const MISLEADING = /\b(?:halv\w*|half|50 ?%|clinically proven|proven)\b/i;
export const CANARY = /verified by wellnessdaily/i;

export const misleading = (text) => statedAsFact(text, MISLEADING);
