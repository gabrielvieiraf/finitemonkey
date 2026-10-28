export const SHELLS = ["sh", "bash", "cmd", "powershell", "pwsh", "none"] as const;

export type ShellChoice = (typeof SHELLS)[number];

export interface Invocation {
  readonly command: string;
  readonly args: readonly string[];
  readonly shell: boolean;
}

export const parseShellChoice = (raw: string | undefined): ShellChoice | undefined =>
  SHELLS.find((shell) => shell === raw?.toLowerCase());

export const defaultShell = (platform: NodeJS.Platform): ShellChoice => (platform === "win32" ? "powershell" : "sh");

const SAFE = /^[\w@%+=:,./-]+$/;

export const quoteArg = (arg: string): string => (SAFE.test(arg) ? arg : `"${arg.replace(/(["\\$`])/g, "\\$1")}"`);

export const commandLine = (words: readonly string[]): string =>
  words.length === 1 ? (words[0] ?? "") : words.map(quoteArg).join(" ");

export const powershellLine = (line: string): string =>
  `$global:LASTEXITCODE = $null; ${line}; $fmOk = $?; if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }; if (-not $fmOk) { exit 1 }`;

export const invocationFor = (choice: ShellChoice, words: readonly string[]): Invocation => {
  const line = commandLine(words);
  switch (choice) {
    case "powershell":
    case "pwsh":
      return {
        command: choice,
        args: ["-NoProfile", "-NonInteractive", "-Command", powershellLine(line)],
        shell: false,
      };
    case "cmd":
      return { command: "cmd.exe", args: ["/d", "/s", "/c", line], shell: false };
    case "bash":
      return { command: "bash", args: ["-c", line], shell: false };
    case "sh":
      return { command: "sh", args: ["-c", line], shell: false };
    case "none":
      return { command: words[0] ?? "", args: words.slice(1), shell: false };
  }
};
