import type { HookHandler } from "../../hooks/handlers.js";
import { remotesWithCredentials } from "../remotes.js";

export const secretsSessionStart: HookHandler = (input) => {
  const remotes = remotesWithCredentials(input.runtime, input.cwd);
  if (remotes.length === 0) return { kind: "allow" };
  const params = { remotes: remotes.join(", "), remote: remotes[0] ?? "origin" };
  const text = input.t("secrets.session.remote_credential", params);
  return {
    kind: "allow",
    output: {
      systemMessage: `finitemonkey: ${text}`,
      hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text },
    },
  };
};
