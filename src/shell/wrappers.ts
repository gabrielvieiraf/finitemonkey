export interface WrapperSpec {
  readonly withValue: ReadonlySet<string>;
  readonly positionals: number;
  readonly queries: ReadonlySet<string>;
}

const spec = (withValue: readonly string[], positionals = 0, queries: readonly string[] = []): WrapperSpec => ({
  withValue: new Set(withValue),
  positionals,
  queries: new Set(queries),
});

export const WRAPPERS: Readonly<Record<string, WrapperSpec>> = {
  sudo: spec(["-u", "-g", "-h", "-p", "-C", "-D", "-r", "-t", "-U", "-T", "--user", "--group", "--host", "--prompt"]),
  doas: spec(["-u", "-C"]),
  command: spec([], 0, ["-v", "-V"]),
  builtin: spec([]),
  exec: spec(["-a"]),
  nohup: spec([]),
  time: spec(["-f", "-o", "--format", "--output"]),
  nice: spec(["-n", "--adjustment"]),
  ionice: spec(["-c", "-n", "-p", "--class", "--classdata"]),
  timeout: spec(["-s", "-k", "--signal", "--kill-after"], 1),
  stdbuf: spec(["-i", "-o", "-e", "--input", "--output", "--error"]),
  xargs: spec([
    "-I",
    "-n",
    "-P",
    "-d",
    "-L",
    "-E",
    "-s",
    "-a",
    "--max-args",
    "--max-procs",
    "--delimiter",
    "--arg-file",
  ]),
  watch: spec(["-n", "--interval"]),
  chronic: spec([]),
  unbuffer: spec([]),
  npx: spec(["-p", "--package", "-c", "--call"]),
  bunx: spec([]),
  "run-one": spec([]),
};

export const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish", "busybox"]);

export const SHELL_WITH_VALUE = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);

export const POWERSHELLS = new Set(["powershell", "pwsh", "powershell.exe", "pwsh.exe"]);
