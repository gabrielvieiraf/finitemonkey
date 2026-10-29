import { contextOutput, projectPaths } from "../gate/hooks/common.js";
import type { HookHandler, HookHandlers } from "../hooks/handlers.js";
import { cachedPersonAreas, dueQuestions, optedIn, takeQuestion } from "./who-knows.js";

const allow = { kind: "allow" } as const;

export const spacedQuestion: HookHandler = (input) => {
  const paths = projectPaths(input);
  if (paths === undefined || !optedIn(input.runtime, paths)) return allow;
  const areas = cachedPersonAreas(input.runtime, paths);
  if (areas.size === 0) return allow;
  const question = takeQuestion(
    input.runtime,
    paths,
    input.payload.sessionId ?? "",
    dueQuestions(input.runtime, paths, areas),
  );
  if (question === undefined) return allow;
  const text = input.t("knowledge.map.question", { text: question.text, anchor: question.anchor });
  return { kind: "allow", output: contextOutput("SessionStart", text) };
};

export const KNOWLEDGE_MAP_HANDLERS: HookHandlers = { SessionStart: [spacedQuestion] };
