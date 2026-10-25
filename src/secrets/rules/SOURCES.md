# Secret rules: ids and sources

Every rule lives in `providers.ts` or `structural.ts` as data (`defineRule`). The id is the stable name used in block messages, in the masker (`«secret:<id>:<last4>»`), in `.finitemonkey/findings/baseline.json` and in incidents. Ids never change meaning; a rule that changes behavior gets a new id.

Several rules mirror the default rule set of [gitleaks](https://github.com/gitleaks/gitleaks) (MIT, `config/gitleaks.toml`). Where a rule mirrors one, the gitleaks id is listed and the Finite Monkey id is the same, so a finding reads the same in both engines (spec 4.26.2: same corpus, same result). The patterns were rewritten for JavaScript regular expressions and tuned against the corpus in `test/secrets-rules.test.ts`; they are not a copy of the TOML.

| Id | Detects | Kind | Source |
|---|---|---|---|
| `aws-access-token` | AWS access key id (`AKIA`, `ASIA`, `ABIA`, `ACCA`, `A3T`) | credential | gitleaks `aws-access-token` |
| `aws-secret-access-key` | 40-character AWS secret assigned to `aws_secret_access_key` or similar | credential | Finite Monkey, pairs with the key id; gitleaks has no separate id |
| `github-pat` | GitHub classic token `ghp_` | credential | gitleaks `github-pat` |
| `github-oauth` | GitHub OAuth token `gho_` | credential | gitleaks `github-oauth` |
| `github-app-token` | GitHub App tokens `ghu_`, `ghs_` | credential | gitleaks `github-app-token` |
| `github-refresh-token` | GitHub refresh token `ghr_` | credential | gitleaks `github-refresh-token` |
| `github-fine-grained-pat` | GitHub fine-grained token `github_pat_` | credential | gitleaks `github-fine-grained-pat` |
| `gitlab-pat` | GitLab token `glpat-` | credential | gitleaks `gitlab-pat` |
| `npm-access-token` | npm token `npm_` | credential | gitleaks `npm-access-token` |
| `slack-bot-token` | Slack `xoxb-` | credential | gitleaks `slack-bot-token` |
| `slack-user-token` | Slack `xoxp-`, `xoxe-` | credential | gitleaks `slack-user-token` |
| `slack-app-token` | Slack `xapp-` | credential | gitleaks `slack-app-token` |
| `slack-webhook-url` | `hooks.slack.com/services/...` | credential | gitleaks `slack-webhook-url` |
| `stripe-access-token` | Stripe `sk_live_`, `rk_live_` (test keys are not flagged) | credential | gitleaks `stripe-access-token`, narrowed to live keys |
| `anthropic-api-key` | Anthropic `sk-ant-api03-`, `sk-ant-admin01-` | credential | gitleaks `anthropic-api-key` and `anthropic-admin-api-key`, merged |
| `openai-api-key` | OpenAI keys with the `T3BlbkFJ` marker or the `sk-proj-`, `sk-svcacct-`, `sk-admin-` prefixes | credential | gitleaks `openai-api-key`, extended to project keys |
| `gcp-api-key` | Google API key `AIza` | credential | gitleaks `gcp-api-key` |
| `asaas-api-key` | Asaas key `$aact_` with a body of at least 32 characters | credential | Finite Monkey; real case Clubfy CC13 (spec 4.26.2): the bare prefix and `$aact_hmlg_...` are placeholders |
| `private-key` | PEM private key block, any type | credential | gitleaks `private-key` |
| `jwt` | JSON Web Token with entropy of at least 3 | credential | gitleaks `jwt` |
| `credential-in-url` | `scheme://user:secret@host`, git remotes included | credential | Finite Monkey `credential-in-remote` (spec 4.26.2, finding PA3) |
| `default-secret-fallback` | `process.env.X ?? 'constant'` when X has a secret name | practice | Finite Monkey (spec 4.26.2, finding PA2) |
| `default-secret-fallback-python` | `os.getenv("X", "constant")` when X has a secret name | practice | Finite Monkey (spec 4.26.2, finding PA2) |
| `generic-api-key` | High-entropy value assigned to a name with key, secret, token or credential | credential | gitleaks `generic-api-key`, with a random-run check and ignored names |
| `password-assignment` | Literal assigned to password, passwd, pwd, senha, contraseña | credential | Finite Monkey |

## Kinds

- `credential`: a value that works as a key. The prompt guard, the PostToolUse guard and the masker use only these.
- `practice`: code that is unsafe even when the value is not a live key. Write guards and scans report it; the masker does not mask it.

## Thresholds and allowlists

- Each rule has `keywords`: the text is lowercased once and a rule runs only if one keyword appears (the gitleaks keyword prefilter).
- `minLength`, `minEntropy` (Shannon, bits per character) and `requireDigit` are per rule.
- `minRandomRun` (generic rule only): the value needs a run of at least 12 letters and digits that mixes both and has entropy of at least 3, so identifiers such as `error.i18n_catalog_unreadable` pass.
- `ignoredNames` (generic rule only): exact names such as `key` and `idempotencyKey` are object keys, not secrets.
- A value is a placeholder when it contains a placeholder word (`example`, `your_`, `_here`, `changeme`, `dummy`, `fake`, `sample`, `mock`, `fixture`, `test`, `xxxx`, `...`, `<`, `${`, `process.env` and others), is an environment reference such as `$TOKEN` or `${TOKEN}`, is a bare word such as `password`, or has fewer than four distinct characters. `practice` rules skip this check on purpose: a constant fallback is the problem even when it is zeros.
- Rules with `skipTestPaths` (`generic-api-key`, `password-assignment` and the two `default-secret-fallback` rules) do not run on lockfiles or under test, fixture and example paths. Provider rules run everywhere: a real `ghp_` token in a test file is still a leak.
