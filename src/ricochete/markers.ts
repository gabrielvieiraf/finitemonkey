const HORIZON = [
  /questions an expert would ask/i,
  /rewritten request/i,
  /perguntas que um especialista faria/i,
  /pedido reescrito/i,
  /preguntas que har[ií]a un experto/i,
];

const CRITERION =
  /(?:judgment criterion|crit[eé]rio de julgamento|criterio de juicio)\s*:\s*`?([A-Za-z0-9][A-Za-z0-9._/-]*)/gi;

const PERTURBATION = /perturbation questions|perguntas de perturba[cç][aã]o|preguntas de perturbaci[oó]n/i;

export const isHorizonHelp = (message: string): boolean => HORIZON.some((pattern) => pattern.test(message));

export const criterionIds = (message: string): readonly string[] =>
  [...message.matchAll(CRITERION)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));

export const hasPerturbation = (message: string): boolean => PERTURBATION.test(message);
