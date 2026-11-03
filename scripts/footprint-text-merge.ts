import type { Localized } from "./footprint-text.js";

export const MERGE_FOOTPRINT_TEXT: Readonly<Record<"look-browser" | "look-deep" | "merge-fetch", Localized>> = {
  "look-browser": {
    en: "Playwright downloads Chromium (about 180 MB) from its download host, only after `init --look --yes` from you. Without `--yes` it only prints the command and the size.",
    "pt-BR":
      "O Playwright baixa o Chromium (cerca de 180 MB) do servidor de downloads dele, só depois de um `init --look --yes` seu. Sem `--yes` ele só imprime o comando e o tamanho.",
    es: "Playwright descarga Chromium (unos 180 MB) desde su servidor de descargas, solo después de un `init --look --yes` tuyo. Sin `--yes` solo imprime el comando y el tamaño.",
  },
  "look-deep": {
    en: "`look --deep` runs the project's own `lighthouse` from `node_modules/.bin` against the app on loopback, with its error reporting turned off. Nothing runs without `--deep` or when lighthouse is not installed.",
    "pt-BR":
      "O `look --deep` roda o `lighthouse` do próprio projeto, de `node_modules/.bin`, contra o app no loopback, com o envio de erros desligado. Nada roda sem `--deep` ou quando o lighthouse não está instalado.",
    es: "`look --deep` ejecuta el `lighthouse` del propio proyecto, desde `node_modules/.bin`, contra la app en loopback, con el envío de errores apagado. No se ejecuta nada sin `--deep` o si lighthouse no está instalado.",
  },
  "merge-fetch": {
    en: "`merge` runs `git fetch` of the target branch's upstream before merging, only when `merge-fetch` is active in policy.yml, and notes when the base moved.",
    "pt-BR":
      "O `merge` roda `git fetch` do upstream do branch de destino antes de mesclar, só quando `merge-fetch` está ativo no policy.yml, e anota quando a base andou.",
    es: "`merge` ejecuta `git fetch` del upstream de la rama de destino antes de fusionar, solo cuando `merge-fetch` está activo en policy.yml, y anota cuando la base avanzó.",
  },
};
