export const GENERAL_FIELD = "general";

export const PROMPT_FIELDS: readonly { readonly field: string; readonly terms: readonly string[] }[] = [
  {
    field: "law",
    terms: ["law", "laws", "legal", "legislation", "direito", "juridico", "lei", "leis", "derecho", "ley", "leyes"],
  },
  {
    field: "health",
    terms: ["health", "medicine", "medical", "nutrition", "saude", "medicina", "nutricao", "salud", "nutricion"],
  },
  { field: "economics", terms: ["economics", "economy", "economia", "macroeconomics", "microeconomics"] },
  {
    field: "finance",
    terms: ["finance", "finances", "accounting", "investing", "financas", "contabilidade", "finanzas", "contabilidad"],
  },
  {
    field: "mathematics",
    terms: ["math", "mathematics", "maths", "algebra", "calculus", "geometry", "matematica", "calculo"],
  },
  { field: "statistics", terms: ["statistics", "probability", "estatistica", "probabilidade", "estadistica"] },
  { field: "physics", terms: ["physics", "fisica", "mechanics", "thermodynamics"] },
  { field: "chemistry", terms: ["chemistry", "quimica"] },
  { field: "biology", terms: ["biology", "biologia", "genetics", "genetica"] },
  { field: "history", terms: ["history", "historia"] },
  { field: "philosophy", terms: ["philosophy", "filosofia", "ethics", "etica", "logic", "logica"] },
  { field: "music", terms: ["music", "musica", "harmony", "harmonia", "armonia"] },
  {
    field: "interface",
    terms: ["css", "html", "react", "frontend", "ui", "ux", "accessibility", "acessibilidade", "accesibilidad"],
  },
  { field: "backend", terms: ["sql", "database", "databases", "postgres", "backend", "banco", "graphql", "orm"] },
  {
    field: "infrastructure",
    terms: ["docker", "kubernetes", "terraform", "linux", "git", "networking", "dns", "infraestrutura"],
  },
  {
    field: "security",
    terms: ["security", "cryptography", "encryption", "oauth", "seguranca", "seguridad", "criptografia"],
  },
  { field: "product", terms: ["product", "pricing", "marketing", "produto", "producto", "growth"] },
];

export const fieldOfWords = (words: readonly string[]): string =>
  PROMPT_FIELDS.find((item) => words.some((word) => item.terms.includes(word)))?.field ?? GENERAL_FIELD;
