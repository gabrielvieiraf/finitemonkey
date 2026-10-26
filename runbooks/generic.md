# Any other credential

Applies to rules without a provider runbook: `generic-api-key`, `jwt`, `private-key`, `gitlab-pat`, `npm-access-token` and the Slack rules.

## 1. Revoke

Find the provider that issued the value and revoke or disable it there. For a private key, remove its public half from every place that trusts it (`authorized_keys`, deploy keys, certificates). For a JWT signing secret, rotate the secret, which invalidates every token it signed.

## 2. Issue the new credential

Prefer short-lived credentials (OIDC, roles, tokens with an expiry) over long-lived ones, and give the new value only the scope the consumer needs.

## 3. Replace it in every consumer

Update the secret store, CI secrets, `.env` files outside git and every host that had the old value.

## 4. Check for misuse in the exposure window

Read the provider's audit or access log from the first exposure until revocation and look for actions you did not take.

## 5. Delete the old credential after observation

Delete leftover records of the old value once consumers have run without errors for a few days.

## 6. Notification duties

If the credential reached personal data, assess notice duties under the law that applies.

## Sources

- https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html (accessed 2026-10-26)
