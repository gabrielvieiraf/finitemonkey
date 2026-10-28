import type { AbsolutePath } from "../core/brand.js";
import { isRecord, parseJsonObject } from "../core/parsed.js";
import { detectPackageManager, type PackageManager } from "../install/detect.js";
import { type Project, projectAt, type ProjectRuntime } from "../install/project.js";

export const ESLINT_CONFIGS = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
] as const;

const LEGACY_ESLINT = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
];
const PYTHON_MARKERS = ["pyproject.toml", "requirements.txt", "setup.py", "Pipfile"];
const HTTP_CLIENTS = ["axios", "ky", "ofetch", "got", "superagent"] as const;
const DEFAULT_EXPORT_FRAMEWORKS = ["next", "@remix-run/react", "@react-router/dev", "astro", "nuxt"] as const;
const TEST_RUNNERS = ["vitest", "jest"] as const;

export interface Stack {
  readonly root: AbsolutePath;
  readonly node: boolean;
  readonly packageManager: PackageManager | undefined;
  readonly typescript: boolean;
  readonly tsEslint: boolean;
  readonly eslint: boolean;
  readonly eslintConfig: string | undefined;
  readonly legacyEslint: string | undefined;
  readonly python: boolean;
  readonly dependencies: ReadonlySet<string>;
  readonly scripts: ReadonlySet<string>;
  readonly httpClients: readonly string[];
  readonly defaultExports: boolean;
  readonly testRunner: string | undefined;
  readonly dirs: (candidates: readonly string[]) => readonly string[];
}

const recordKeys = (value: unknown): readonly string[] => (isRecord(value) ? Object.keys(value) : []);

const manifest = (project: Project): Readonly<Record<string, unknown>> => {
  const text = project.read("package.json");
  const parsed = text === undefined ? undefined : parseJsonObject(text);
  return parsed?.ok === true ? parsed.value : {};
};

export const detectStack = (runtime: ProjectRuntime, root: AbsolutePath): Stack => {
  const project = projectAt(root, runtime);
  const pkg = manifest(project);
  const dependencies = new Set([...recordKeys(pkg["dependencies"]), ...recordKeys(pkg["devDependencies"])]);
  return {
    root,
    node: project.exists("package.json"),
    packageManager: project.exists("package.json") ? (detectPackageManager(project) ?? "npm") : undefined,
    typescript: project.exists("tsconfig.json") || dependencies.has("typescript"),
    tsEslint: dependencies.has("typescript-eslint"),
    eslint: dependencies.has("eslint"),
    eslintConfig: ESLINT_CONFIGS.find((file) => project.exists(file)),
    legacyEslint: LEGACY_ESLINT.find((file) => project.exists(file)),
    python: PYTHON_MARKERS.some((file) => project.exists(file)),
    dependencies,
    scripts: new Set(recordKeys(pkg["scripts"])),
    httpClients: HTTP_CLIENTS.filter((name) => dependencies.has(name)),
    defaultExports: DEFAULT_EXPORT_FRAMEWORKS.some((name) => dependencies.has(name)),
    testRunner: TEST_RUNNERS.find((name) => dependencies.has(name)),
    dirs: (candidates) => candidates.filter((dir) => project.isDir(dir)),
  };
};
