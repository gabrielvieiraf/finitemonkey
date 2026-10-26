import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractProse } from "../src/prose/extract.js";
import { isFlagged, scoreProse } from "../src/prose/score.js";
import type { ProseRuleId } from "../src/prose/types.js";

const rules = (text: string): readonly ProseRuleId[] => scoreProse(text).hits.map((hit) => hit.rule);

describe("prose rules: each tell is detected in en, pt-BR and es", () => {
  const cases: readonly { readonly rule: ProseRuleId; readonly texts: readonly string[] }[] = [
    {
      rule: "opener-routine",
      texts: [
        "You know the routine. The tests fail.",
        "Você conhece a rotina e o teste quebra.",
        "Ya conoces la rutina.",
      ],
    },
    {
      rule: "reassurance",
      texts: ["That is not a character flaw.", "Ninguém aqui é preguiçoso.", "Aquí nadie es vago."],
    },
    {
      rule: "crutch-word",
      texts: ["It integrates seamlessly with git.", "Vale ressaltar que o cache existe.", "En resumen, funciona."],
    },
    {
      rule: "abstract-noun",
      texts: ["It is just the pace of the work.", "É o ritmo do trabalho.", "Es el ritmo del trabajo."],
    },
    {
      rule: "slogan-closer",
      texts: ["The cache is warm.\n\nAnd that changes everything.", "Simples assim.", "Así de simple."],
    },
    {
      rule: "rhythmic-triplet",
      texts: ["Faster builds. Fewer flakes. Happier developers. The cache now lives on disk for every job."],
    },
    {
      rule: "imperative-fragment",
      texts: ["Type however you like. Ship whenever you want. It takes care of the rest."],
    },
    { rule: "antithesis", texts: ["Finite Monkey is a gate, not a linter."] },
    { rule: "colon-heading", texts: ["## Speed: the new normal\n\nText."] },
    { rule: "decorative-emoji", texts: ["## 🚀 Install\n\nText."] },
    { rule: "em-dash-series", texts: ["It runs — fast — and it stops — always."] },
  ];
  for (const { rule, texts } of cases) {
    for (const text of texts) {
      it(`${rule}: ${text.slice(0, 40)}`, () => {
        assert.ok(rules(text).includes(rule), `${rule} not found in ${JSON.stringify(rules(text))}`);
      });
    }
  }
});

describe("prose density: several tells close together, not one", () => {
  const flagged = [
    "You know the routine. That is not a character flaw. It is the pace of the work.",
    "This PR seamlessly integrates the cache. It leverages the queue.",
  ];
  const passing = [
    "The retry logic is robust to a dropped connection: a failed upload is retried three times.",
    "Ya conoces la rutina del lunes: el job de las 9:00 falla y alguien lo relanza a mano sin mirar el log.",
    "Type however you want. Work with whichever AI you like. Write code as fast as you can.",
  ];
  for (const text of flagged)
    it(`flags: ${text.slice(0, 40)}`, () => {
      assert.ok(isFlagged(scoreProse(text)));
    });
  for (const text of passing)
    it(`passes: ${text.slice(0, 40)}`, () => {
      assert.ok(!isFlagged(scoreProse(text)));
    });

  it("tells in different sections do not add up", () => {
    const one = "The sync is seamless for people who already run the CLI every day.";
    const two = "The retry is robust to a dropped connection on the first upload.";
    assert.equal(scoreProse(`## One\n\n${one}\n\n## Two\n\n${two}\n`).spans.length, 0);
    assert.equal(scoreProse(`${one} ${two}`).spans.length, 1);
  });

  it("a span reports its lines and every hit inside it", () => {
    const [span] = scoreProse("Intro line.\n\nYou know the routine.\nNobody is lazy here.\n").spans;
    assert.equal(span?.startLine, 3);
    assert.equal(span.endLine, 4);
    assert.deepEqual(
      span.hits.map((hit) => hit.rule),
      ["opener-routine", "reassurance", "slogan-closer"],
    );
  });
});

describe("prose extraction skips what is not prose", () => {
  const bad = "It is seamless. It is robust. Nobody is lazy here.";
  const skipped = [
    ["a fenced code block", `\`\`\`\n${bad}\n\`\`\`\n`],
    ["inline code", `Run \`${bad}\` now.`],
    ["a link", `See [${bad}](https://example.com).`],
    ["a table", `| a | b |\n|---|---|\n| ${bad} | x |\n`],
    ["a quote", `> ${bad}\n`],
    ["quoted text", `The old copy said "${bad}" and we removed it.`],
    ["frontmatter", `---\ndescription: ${bad}\n---\nPlain text.\n`],
    ["an HTML comment", `<!--\n${bad}\n-->\nPlain text.\n`],
  ] as const;
  for (const [name, text] of skipped) {
    it(`skips ${name}`, () => {
      assert.deepEqual(rules(text), []);
    });
  }

  it("keeps line numbers across wrapped paragraphs", () => {
    const { units } = extractProse("# Title\n\nFirst sentence.\nSecond sentence\ncontinues here. Third.\n");
    assert.deepEqual(
      units.map((unit) => [unit.kind, unit.line]),
      [
        ["heading", 1],
        ["sentence", 3],
        ["sentence", 4],
        ["sentence", 5],
      ],
    );
  });
});

describe("allow markers that only the person adds", () => {
  const bad = "You know the routine. That is not a character flaw. It is the pace of the work.";

  it("a file marker skips the whole file", () => {
    const report = scoreProse(`<!-- finitemonkey:prose-allow-file -->\n\n${bad}\n`);
    assert.equal(report.allowed, true);
    assert.equal(report.hits.length, 0);
  });

  it("a marker on its own line skips the next paragraph only", () => {
    const text = `<!-- finitemonkey:prose-allow -->\n${bad}\n\n${bad}\n`;
    const report = scoreProse(text);
    assert.equal(report.spans.length, 1);
    assert.equal(report.spans[0]?.startLine, 4);
  });

  it("a marker at the end of a line skips that line", () => {
    assert.equal(scoreProse(`${bad} <!-- finitemonkey:prose-allow -->\n`).hits.length, 0);
  });

  it("ignores a marker named outside an HTML comment", () => {
    const report = scoreProse(`The person adds \`finitemonkey:prose-allow-file\`.\n\n${bad}\n`);
    assert.ok(!report.allowed);
    assert.ok(isFlagged(report));
  });

  it("ignores a marker quoted in inline code or a code block", () => {
    const texts = [
      `Add \`<!-- finitemonkey:prose-allow-file -->\` to skip a file.\n\n${bad}\n`,
      `\`\`\`md\n<!-- finitemonkey:prose-allow-file -->\n\`\`\`\n\n${bad}\n`,
      `${bad} \`<!-- finitemonkey:prose-allow -->\`\n`,
    ];
    for (const text of texts) {
      const report = scoreProse(text);
      assert.ok(!report.allowed, text);
      assert.ok(isFlagged(report), text);
    }
  });
});

describe("record rules for commits, PRs, issues and changelogs", () => {
  const cases: readonly { readonly rule: ProseRuleId; readonly texts: readonly string[] }[] = [
    {
      rule: "requester-reference",
      texts: [
        "fix: empty body as requested",
        "fix: corpo vazio conforme solicitado",
        "fix: cuerpo vacío según lo pedido",
      ],
    },
    {
      rule: "person-as-reason",
      texts: [
        "docs: Gabriel's text in the intro",
        "docs: introdução do readme com o texto do gabriel",
        "docs: el texto de Ana",
      ],
    },
    {
      rule: "origin-project",
      texts: [
        "docs: badges in the style of shields",
        "docs: badges no estilo do julius2claude",
        "docs: al estilo de shields",
      ],
    },
    { rule: "first-person", texts: ["I changed the merge order.", "fiz o merge na ordem certa", "cambié el orden"] },
    {
      rule: "padding",
      texts: ["This commit adds a flag.", "Este PR tem como objetivo somar uma flag.", "Este commit suma una opción."],
    },
  ];
  for (const { rule, texts } of cases) {
    for (const text of texts) {
      it(`${rule} flags a single occurrence in a record: ${text}`, () => {
        const report = scoreProse(text, { context: "record" });
        assert.ok(isFlagged(report));
        assert.ok(report.hits.some((hit) => hit.rule === rule));
      });
      it(`${rule} stays out of README prose: ${text}`, () => {
        assert.ok(!scoreProse(text).hits.some((hit) => hit.rule === rule));
      });
    }
  }

  const technical = [
    "docs: introdução do readme reescrita",
    "docs: badges com ícone do npm e downloads",
    "fix(install): ajusta o texto do README e do aviso de backup",
    "feat(gate): the report lists every check by name",
    "refactor(prose): ideia do módulo separada do catálogo",
    "docs: texto do projeto em três idiomas",
  ];
  for (const text of technical) {
    it(`passes a technical record: ${text}`, () => {
      assert.ok(!isFlagged(scoreProse(text, { context: "record" })));
    });
  }
});
