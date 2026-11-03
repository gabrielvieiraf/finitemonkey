export const LANGS = ["en", "pt", "es"] as const;
export type Lang = (typeof LANGS)[number];

export interface HeroLabels {
  readonly a: string;
  readonly b: string;
  readonly c: string;
  readonly d: string;
  readonly e: string;
  readonly f: string;
}

export interface UiText {
  readonly htmlLang: string;
  readonly mdSuffix: string;
  readonly file: string;
  readonly contents: string;
  readonly minutes: (n: number) => string;
  readonly github: string;
  readonly back: string;
  readonly essays: string;
  readonly essay: (n: number) => string;
  readonly skip: string;
  readonly top: string;
  readonly languages: string;
  readonly fullSize: string;
  readonly markdown: string;
}

export const UI: Readonly<Record<Lang, UiText>> = {
  en: {
    htmlLang: "en",
    mdSuffix: "",
    file: "index.html",
    contents: "contents",
    minutes: (n) => `${String(n)} min read`,
    github: "read on GitHub",
    back: "← finitemonkey",
    essays: "essays",
    essay: (n) => `essay ${String(n)}`,
    skip: "Skip to the text",
    top: "back to top ↑",
    languages: "Language",
    fullSize: "open full size",
    markdown: "Markdown source",
  },
  pt: {
    htmlLang: "pt-BR",
    mdSuffix: ".pt-BR",
    file: "pt.html",
    contents: "sumário",
    minutes: (n) => `${String(n)} min de leitura`,
    github: "ler no GitHub",
    back: "← finitemonkey",
    essays: "ensaios",
    essay: (n) => `ensaio ${String(n)}`,
    skip: "Pular para o texto",
    top: "voltar ao topo ↑",
    languages: "Idioma",
    fullSize: "abrir em tamanho real",
    markdown: "fonte em Markdown",
  },
  es: {
    htmlLang: "es",
    mdSuffix: ".es",
    file: "es.html",
    contents: "índice",
    minutes: (n) => `${String(n)} min de lectura`,
    github: "leer en GitHub",
    back: "← finitemonkey",
    essays: "ensayos",
    essay: (n) => `ensayo ${String(n)}`,
    skip: "Saltar al texto",
    top: "volver arriba ↑",
    languages: "Idioma",
    fullSize: "abrir a tamaño real",
    markdown: "fuente en Markdown",
  },
};

export const HERO_ID = ["ricochet", "second-brain"] as const;
export type HeroId = (typeof HERO_ID)[number];

export interface Essay {
  readonly slug: HeroId;
  readonly number: number;
  readonly hero: Readonly<Record<Lang, HeroLabels>>;
  readonly summary: Readonly<Record<Lang, string>>;
}

export const ESSAYS: readonly Essay[] = [
  {
    slug: "ricochet",
    number: 1,
    hero: {
      en: { a: "blind band", b: "discernment", c: "proximal band", d: "alone", e: "task shifts", f: "assistance" },
      pt: {
        a: "faixa cega",
        b: "discernimento",
        c: "faixa proximal",
        d: "sozinho",
        e: "tarefa muda",
        f: "assistência",
      },
      es: {
        a: "franja ciega",
        b: "discernimiento",
        c: "franja proximal",
        d: "solo",
        e: "la tarea cambia",
        f: "asistencia",
      },
    },
    summary: {
      en: "Two boundaries a person can't see from inside: what they don't know to ask for and what they can't evaluate. Section 10 ties each mechanism to an executable check at those points.",
      pt: "Duas fronteiras que a pessoa não vê de dentro: o que ela não sabe pedir e o que não consegue avaliar. A seção 10 liga cada mecanismo a uma checagem executável nesses pontos.",
      es: "Dos fronteras que la persona no ve desde dentro: lo que no sabe pedir y lo que no puede evaluar. La sección 10 une cada mecanismo a una comprobación ejecutable en esos puntos.",
    },
  },
  {
    slug: "second-brain",
    number: 2,
    hero: {
      en: { a: "note", b: "anchored claim", c: "code", d: "verified", e: "stale", f: "rots silently" },
      pt: { a: "nota", b: "afirmação ancorada", c: "código", d: "verificada", e: "vencida", f: "apodrece calada" },
      es: {
        a: "nota",
        b: "afirmación anclada",
        c: "código",
        d: "verificada",
        e: "caducada",
        f: "se pudre en silencio",
      },
    },
    summary: {
      en: "Context files and memories barely help the agent and go stale without warning. The proposal: each claim about the code bound to the hash of the code it describes and verified by running it.",
      pt: "Arquivos de contexto e memórias quase não ajudam o agente e envelhecem sem aviso. A proposta: cada afirmação sobre o código presa ao hash do trecho que descreve e verificada por execução.",
      es: "Los archivos de contexto y las memorias apenas ayudan al agente y envejecen sin aviso. La propuesta: cada afirmación sobre el código atada al hash del código que describe y verificada al ejecutarla.",
    },
  },
];

export const REPO = "https://github.com/gabrielvieiraf/finitemonkey";
export const SITE = "https://gabrielvieiraf.github.io/finitemonkey/";
