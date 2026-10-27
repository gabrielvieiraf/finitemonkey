# Anthropic API keys

Applies to rule `anthropic-api-key`.

## 1. Revoke

In the Claude Console, open **Settings** > **API keys** and disable or delete the key. With an admin key, `POST /v1/organizations/api_keys/{api_key_id}` with `{"status": "inactive"}` does the same.

## 2. Issue the new credential

Create the new key in a workspace that holds only this application, with spend limits set on that workspace. Do not reuse one key across environments.

## 3. Replace it in every consumer

Update the secret store, CI secrets and every service that reads `ANTHROPIC_API_KEY`.

## 4. Check for misuse in the exposure window

Review usage and cost for the workspace in the window. Requests or spend you cannot explain mean the key was used by someone else.

## 5. Delete the old credential after observation

After a few days with no errors from consumers, archive or delete the disabled key.

## 6. Notification duties

Prompts and files sent with the key may hold personal data. If the key could read stored files or batches, assess notice duties.

## Sources

- https://platform.claude.com/docs/en/api/admin-api/apikeys/update-api-key (accessed 2026-10-26)
