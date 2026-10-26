# Google OAuth client secrets and API keys

Applies to rule `gcp-api-key` and to OAuth client secrets found by the generic rules.

## 1. Revoke

For an API key, open **APIs & Services** > **Credentials** and regenerate or delete the key. For an OAuth client secret, add a new secret to the client, then disable the exposed one.

## 2. Issue the new credential

Restrict a new API key to the APIs it calls and to the referrers, IPs or apps that use it. For OAuth, keep the client and rotate only the secret. For server-to-server access prefer workload identity federation over service account key files.

## 3. Replace it in every consumer

Update the backend configuration, CI secrets and any mobile or web build that embeds the key.

## 4. Check for misuse in the exposure window

Check API usage metrics and billing for the key's project in the window, and Cloud Audit Logs for calls you do not recognize.

## 5. Delete the old credential after observation

Delete the disabled OAuth secret once the new one has served traffic without errors.

## 6. Notification duties

If the client could read user data through granted scopes, assess notice duties toward those users and the regulator.

## Sources

- https://support.google.com/cloud/answer/6158849 (accessed 2026-10-26)
