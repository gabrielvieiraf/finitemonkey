# GitHub tokens

Applies to rules `github-pat`, `github-oauth`, `github-app-token`, `github-refresh-token` and `github-fine-grained-pat`.

## 1. Revoke

For a personal access token, go to **Settings** > **Developer settings** > **Personal access tokens** and delete it. For an OAuth or GitHub App token, revoke the authorization under **Settings** > **Applications**, or rotate the app's client secret. A revoked token cannot be restored.

## 2. Issue the new credential

Use the narrowest path that works: `GITHUB_TOKEN` inside Actions, a GitHub App installation token for automation, or a fine-grained personal access token limited to the repositories and permissions the consumer needs, with an expiration date.

## 3. Replace it in every consumer

Update repository and organization secrets, CI variables, local `gh auth` sessions, git remotes that carried the token in the URL (`git remote set-url`) and credential helpers.

## 4. Check for misuse in the exposure window

Check the security log (**Settings** > **Security log**, or the organization audit log) for the window: new deploy keys, new tokens, changed branch protection, pushes and releases you did not make, and repositories made public or transferred.

## 5. Delete the old credential after observation

A deleted token is already gone. If you only reduced an app's access, remove the old installation or secret after a few days without failures.

## 6. Notification duties

If private repositories with personal data or customer code were readable, tell the owners of that data and check contractual and legal duties to notify.

## Sources

- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/token-expiration-and-revocation (accessed 2026-10-26)
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens (accessed 2026-10-26)
