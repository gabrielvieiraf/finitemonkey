import type { Persona } from "../persona.ts";
import { baby } from "./baby.ts";
import { beginner } from "./beginner.ts";
import { everything } from "./everything.ts";
import { precise } from "./precise.ts";
import { senior } from "./senior.ts";

export const personas: readonly Persona[] = [baby, beginner, everything, precise, senior];
