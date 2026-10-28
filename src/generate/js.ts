export const esImport = (binding: string, module: string): string =>
  `import ${binding} from ${JSON.stringify(module)};`;
