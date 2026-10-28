const quoted = (module: string): string => JSON.stringify(module);

export const imported = (names: string, module: string): string => `import ${names} from ${quoted(module)};`;

export const closeImport = (module: string): string => `} from ${quoted(module)};`;
