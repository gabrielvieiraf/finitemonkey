import type { Localized } from "./footprint-text.js";

export const SETUP_FOOTPRINT_TEXT: Readonly<Record<"hook-input" | "claude-settings", Localized>> = {
  "hook-input": {
    en: "The event Claude Code passes to each hook: the tool call, the prompt or the stop request.",
    "pt-BR": "O evento que o Claude Code passa a cada hook: a chamada de ferramenta, o prompt ou o pedido de parada.",
    es: "El evento que Claude Code pasa a cada hook: la llamada a la herramienta, el prompt o la petición de parada.",
  },
  "claude-settings": {
    en: "Claude Code settings, to check that the hooks are installed and nothing switches them off. `$CLAUDE_CONFIG_DIR` replaces `~/.claude` when set.",
    "pt-BR":
      "As configurações do Claude Code, para conferir que os hooks estão instalados e que nada os desliga. `$CLAUDE_CONFIG_DIR` substitui `~/.claude` quando definido.",
    es: "La configuración de Claude Code, para comprobar que los hooks están instalados y que nada los desactiva. `$CLAUDE_CONFIG_DIR` reemplaza `~/.claude` si está definido.",
  },
};
