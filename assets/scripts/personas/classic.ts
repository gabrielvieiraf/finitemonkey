import { classicLook, raisedHand } from "../monkey.ts";
import { type Persona, typingKeys } from "../persona.ts";
import { laptop, mouseInHand, mouseOnDesk, mug } from "../props.ts";

export const classic: Persona = {
  id: "classic",
  script: {
    checks: [
      { label: "tests", fail: "missing", pass: "42 passed", passesAtRun: 3 },
      { label: "lint", fail: "17 errors", pass: "clean", passesAtRun: 2 },
      { label: "secrets", fail: ".env in diff", pass: "none", passesAtRun: 2 },
      { label: "types", fail: "9 any", pass: "strict", passesAtRun: 4 },
      { label: "done?", fail: "nope", pass: "verified", passesAtRun: 5 },
    ],
    prompt: "$ finitemonkey gate",
    verdict: "✓ actually done",
    gagFrames: 0,
    celebrateFrames: 26,
    keys: typingKeys,
    gagKeys: [],
    hands: "both",
  },
  confetti: true,
  mood: (ctx) => ctx.frame.mood,
  look: () => classicLook,
  back: () => "",
  props: (ctx, pose) => {
    const hand = raisedHand(pose);
    return laptop() + mug(ctx.frame.beat) + (pose.mood === "celebrate" ? mouseInHand(hand.x, hand.y) : mouseOnDesk());
  },
  front: () => "",
};
