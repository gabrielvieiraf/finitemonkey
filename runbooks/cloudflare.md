# Cloudflare API tokens

Applies to Cloudflare API tokens and global API keys found by the generic rules.

## 1. Revoke

Go to **My Profile** > **API Tokens**, open the menu next to the token and choose **Roll**. Rolling invalidates the old secret at once and keeps the same permissions. A global API key can be changed on the same page.

## 2. Issue the new credential

Prefer a scoped API token over the global API key: only the zones and permissions the consumer needs, with client IP filtering and a TTL when the consumer runs from known addresses.

## 3. Replace it in every consumer

Update CI secrets, Workers secrets, Terraform variables and any tool that calls the API.

## 4. Check for misuse in the exposure window

Read the account audit log for the window: DNS changes, new Workers or routes, page rules, firewall changes, new members and new tokens.

## 5. Delete the old credential after observation

Delete any extra token created during the change once consumers have run without errors for a few days.

## 6. Notification duties

DNS or Workers changes can redirect user traffic. If that happened, treat it as a breach of the affected service and assess notice duties.

## Sources

- https://developers.cloudflare.com/fundamentals/api/how-to/roll-token/ (accessed 2026-10-26)
