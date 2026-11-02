import { Buffer } from "node:buffer";

export const POWERSHELL = "powershell.exe";
export const WINDOWS_TIMEOUT_MS = 2500;

const APP_ID = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe";
const MANAGER = "[Windows.UI.Notifications.ToastNotificationManager]";
const LOAD = `[void]${MANAGER.slice(0, -1)}, Windows.UI.Notifications, ContentType = WindowsRuntime]`;

export const psString = (text: string): string => `'${text.replace(/['‘’‚‛]/g, "$&$&")}'`;

const encoded = (lines: readonly string[]): readonly string[] => [
  "-NoProfile",
  "-NonInteractive",
  "-EncodedCommand",
  Buffer.from(["$ErrorActionPreference = 'Stop'", ...lines].join("\n"), "utf16le").toString("base64"),
];

export const toastArgs = (title: string, body: string): readonly string[] =>
  encoded([
    LOAD,
    `$xml = ${MANAGER}::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)`,
    "$text = $xml.GetElementsByTagName('text')",
    `[void]$text.Item(0).AppendChild($xml.CreateTextNode(${psString(title)}))`,
    `[void]$text.Item(1).AppendChild($xml.CreateTextNode(${psString(body)}))`,
    `${MANAGER}::CreateToastNotifier(${psString(APP_ID)}).Show([Windows.UI.Notifications.ToastNotification]::new($xml))`,
  ]);

export const toastProbeArgs = (): readonly string[] => encoded([LOAD, "exit 0"]);

export const decodeCommand = (args: readonly string[]): string =>
  Buffer.from(args[args.length - 1] ?? "", "base64").toString("utf16le");
