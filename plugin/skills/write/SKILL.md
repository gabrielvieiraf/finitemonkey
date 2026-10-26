---
name: write
description: >-
  Use before writing text other people will read: a README, a PR title or body, an issue, a commit message, release notes, docs or landing copy. Shows the patterns readers recognize as machine-written, what to write instead, and checks the draft with Finite Monkey before it goes out.
when_to_use: >-
  Trigger phrases include write the README, PR description, release notes, changelog, docs, landing page, copy, escreva o README, descrição do PR, notas de versão, texto da página, escribe el README, notas de la versión, texto de la landing.
---

# Write text a person would sign

Readers spot generated text in the first paragraph and stop trusting the rest. Draft, then check the draft before you send it.

## What to write

1. Open with one concrete scene that a developer recognizes, with a real detail: the command, the time, the error message, the file. "Claude Code ended a refactor with `Done! All tests pass.` It had only run the linter." works; "We all know the struggle" does not.
2. Follow with one plain sentence about what the product or the change does.
3. Humor gets one line at most, and never in an error or a security message.
4. For brand text (a tagline, the first paragraph of a README, a landing hero), write two or three alternatives and let the person choose. Their pick is final.
5. In a PR or commit, say what changed, why, and how you verified it, with the command and its exit code.

## What readers reject

| Pattern | Write instead |
|---|---|
| Opening with "you know the routine", "we've all been there" | The scene: who, what command, what broke |
| Consolation lines like "that is not a character flaw", "nobody is lazy" | Describe the problem and let the reader judge |
| Three short sentences in a row for rhythm ("Fast. Simple. Secure.") | One sentence that says what each part does |
| A slogan or aphorism as the last line | A fact or the next step |
| Loose commands as filler ("Type however you like.") | One sentence about what the tool does for the reader |
| "X, not Y" and "it isn't X. It's Y" | Say what it is |
| Abstract nouns ("the pace of the work") | The scene behind the noun |
| Crutch words: delve, seamless, robust, leverage, game-changer, "it's worth noting", "vale ressaltar", "cabe destacar", "en resumen" | The plain word, or a number |
| Headings like "Speed: the new normal" | The reader's question or task as the heading |
| Decorative emoji in headings and bullets | Nothing |
| Em dashes, one after another | A period, a comma or parentheses |

One of these in a long text is fine. Several close together are what readers notice, and that is what the check measures.

## Commits, PRs, issues and changelogs

History text is read years later by people who were not in the conversation, so the rule is stricter: a single occurrence counts.

| Pattern | Write instead |
|---|---|
| Who asked or the conversation: "as requested", "the user asked", "conforme solicitado", "a pedido de", "según lo pedido" | What changed and the technical reason |
| A person's name as the reason: "docs: intro with Ana's text", "o texto do gabriel" | The property of the change: "docs: readme intro rewritten" |
| Another project as the origin: "in the style of X", "no estilo do X", "igual ao Y" | The technical property: "docs: badges with the npm icon and downloads" |
| First or second person narration: "I changed", "you asked", "fiz", "você pediu" | Present tense about the code: "the report lists every check" |
| Padding: "this commit", "this PR aims to", "este PR tem como objetivo" | Start with the change itself |

Check a commit message or PR body with `--record`, which applies this family on top of the general rules.

## Check the draft

Pipe the draft through the check before you open the PR, commit or save the file:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/finitemonkey.mjs" prose check --stdin --json < draft.md
```

For a commit message, PR or issue, add `--record`. For files already on disk, pass the paths instead of `--stdin`. Rewrite every passage in `data.files[].spans` using the rule's "do instead", then check again. Finite Monkey also checks `gh pr create`, `gh issue create` and `git commit -m` before they run.

Never add the `finitemonkey:prose-allow` marker yourself; the hook blocks it. If the person wants a passage kept as it is, they add the marker in their own editor.

If the command answers `unknown_command`, this version of Finite Monkey has no prose check yet: review the draft against the table above and say that it was not checked by the tool.
