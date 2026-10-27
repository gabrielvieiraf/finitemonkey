import type { Domain } from "./types.js";

const TERMS: Readonly<Record<Domain, RegExp>> = {
  product:
    /\b(?:churn|mrr|arr|ltv|cac|pricing|persona|onboarding|funnel|funil|embudo|retention|reten[cç][aã]o|retenci[oó]n|jobs to be done)\b/i,
  interface:
    /\b(?:flexbox|grid|aria|a11y|breakpoint|viewport|component|componente|props|state|estado|hydration|css|tailwind|layout|responsive|responsivo)\b/i,
  backend:
    /\b(?:migration|migra[cç][aã]o|migraci[oó]n|foreign key|chave estrangeira|clave for[aá]nea|index|[ií]ndice|transaction|transa[cç][aã]o|transacci[oó]n|orm|endpoint|idempot\w*|webhook|query|sql|n\+1)\b/i,
  infrastructure:
    /\b(?:docker|kubernetes|k8s|deploy|ci|cd|pipeline|dns|cdn|nginx|terraform|rollback|staging|load balancer|cron|container|cont[eê]iner)\b/i,
  security:
    /\b(?:xss|csrf|ssrf|oauth|jwt|cors|rbac|least privilege|secret|segredo|secreto|hash|bcrypt|rate limit|injection|inje[cç][aã]o|inyecci[oó]n|mfa|2fa)\b/i,
};

const MECHANISM = /\b(?:why|how does|how do|por que|por quê|porque|como funciona|c[oó]mo funciona|por qu[eé])\b/i;

export const domainsMentioned = (text: string): readonly Domain[] =>
  (Object.keys(TERMS) as Domain[]).filter((domain) => TERMS[domain].test(text));

export const asksMechanism = (text: string): boolean => MECHANISM.test(text);
