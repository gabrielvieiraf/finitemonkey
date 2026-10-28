import type { GeneratedFile } from "../generate/plan.js";
import type { ArchConfig, Layer } from "./config.js";
import { camel, deniedPairs, type DenyMessage, dottedModule, layerBases } from "./pairs.js";

const modules = (layer: Layer): readonly string[] =>
  layerBases(layer)
    .map(dottedModule)
    .filter((name) => name !== "");

const rootOf = (config: ArchConfig): string => {
  const first = config.layers.flatMap(modules)[0] ?? "app";
  return first.split(".")[0] ?? first;
};

const indented = (items: readonly string[]): readonly string[] => items.map((item) => `    ${item}`);

export const importLinter = (config: ArchConfig, deny: DenyMessage): GeneratedFile => {
  const contracts = deniedPairs(config, deny).flatMap((pair, index) => [
    "",
    `[importlinter:contract:${String(index + 1)}]`,
    `name = ${pair.message}`,
    "type = forbidden",
    "source_modules =",
    ...indented(modules(pair.from)),
    "forbidden_modules =",
    ...indented(modules(pair.to)),
  ]);
  return {
    path: ".importlinter",
    content: [`[importlinter]`, `root_package = ${rootOf(config)}`, ...contracts, ""].join("\n"),
  };
};

const rootPackage = (config: ArchConfig): string => {
  const all = config.layers.flatMap(modules).map((name) => name.split("."));
  const first = all[0] ?? [];
  const shared = first.filter((part, index) => all.every((parts) => parts[index] === part));
  return shared.join(".") || first.join(".");
};

const packagePattern = (layer: Layer): string => `..${modules(layer)[0]?.split(".").pop() ?? layer.name}..`;

const javaRules = (config: ArchConfig, deny: DenyMessage): readonly string[] =>
  deniedPairs(config, deny).flatMap((pair) => [
    "",
    "  @ArchTest",
    `  static final ArchRule ${camel(`${pair.from.name} not ${pair.to.name}`)} =`,
    `      noClasses().that().resideInAPackage(${JSON.stringify(packagePattern(pair.from))})`,
    `          .should().dependOnClassesThat().resideInAPackage(${JSON.stringify(packagePattern(pair.to))})`,
    `          .because(${JSON.stringify(pair.message)});`,
  ]);

const kotlinRules = (config: ArchConfig, deny: DenyMessage): readonly string[] =>
  deniedPairs(config, deny).flatMap((pair) => [
    "",
    "    @ArchTest",
    `    val ${camel(`${pair.from.name} not ${pair.to.name}`)}: ArchRule =`,
    `        noClasses().that().resideInAPackage(${JSON.stringify(packagePattern(pair.from))})`,
    `            .should().dependOnClassesThat().resideInAPackage(${JSON.stringify(packagePattern(pair.to))})`,
    `            .because(${JSON.stringify(pair.message)})`,
  ]);

const IMPORTS = [
  "import com.tngtech.archunit.core.importer.ImportOption",
  "import com.tngtech.archunit.junit.AnalyzeClasses",
  "import com.tngtech.archunit.junit.ArchTest",
  "import com.tngtech.archunit.lang.ArchRule",
] as const;

export const archUnit = (config: ArchConfig, deny: DenyMessage, kotlin: boolean): GeneratedFile => {
  const root = rootPackage(config);
  const analyze = `@AnalyzeClasses(packages = [${JSON.stringify(root)}], importOptions = [ImportOption.DoNotIncludeTests::class])`;
  if (kotlin) {
    return {
      path: "src/test/kotlin/arch/ArchitectureTest.kt",
      content: [
        "package arch",
        "",
        ...IMPORTS,
        "import com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses",
        "",
        analyze,
        "class ArchitectureTest {",
        ...kotlinRules(config, deny),
        "}",
        "",
      ].join("\n"),
    };
  }
  return {
    path: "src/test/java/arch/ArchitectureTest.java",
    content: [
      "package arch;",
      "",
      ...IMPORTS.map((line) => `${line};`),
      "",
      "import static com.tngtech.archunit.lang.syntax.ArchRuleDefinition.noClasses;",
      "",
      `@AnalyzeClasses(packages = ${JSON.stringify(root)}, importOptions = ImportOption.DoNotIncludeTests.class)`,
      "class ArchitectureTest {",
      ...javaRules(config, deny),
      "}",
      "",
    ].join("\n"),
  };
};

export const depguard = (config: ArchConfig, deny: DenyMessage, goModule: string): GeneratedFile => {
  const pairs = deniedPairs(config, deny);
  const rules = config.layers.flatMap((layer) => {
    const mine = pairs.filter((pair) => pair.from.name === layer.name);
    if (mine.length === 0) return [];
    return [
      `      ${JSON.stringify(layer.name)}:`,
      "        files:",
      ...layer.paths.map((glob) => `          - ${JSON.stringify(`**/${glob}`)}`),
      "        deny:",
      ...mine.flatMap((pair) =>
        layerBases(pair.to).flatMap((base) => [
          `          - pkg: ${JSON.stringify(`${goModule}/${base}`)}`,
          `            desc: ${JSON.stringify(pair.message)}`,
        ]),
      ),
    ];
  });
  return {
    path: ".golangci.yml",
    content: [
      "linters:",
      "  enable:",
      "    - depguard",
      "linters-settings:",
      "  depguard:",
      "    rules:",
      ...rules,
      "",
    ].join("\n"),
  };
};
