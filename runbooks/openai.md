# OpenAI API keys

Applies to rule `openai-api-key`.

## 1. Revoke

On the API keys page of the OpenAI platform, revoke the exposed key. Revocation takes effect at once.

## 2. Issue the new credential

Create a project key or a service account key in a project that holds only this application, with spend limits and, where the organization allows it, a maximum key lifetime.

## 3. Replace it in every consumer

Update the secret store, CI secrets and every service that reads `OPENAI_API_KEY`.

## 4. Check for misuse in the exposure window

Review usage per project and per key in the window. Calls or spend you cannot explain mean the key was used by someone else.

## 5. Delete the old credential after observation

Remove any temporary key created for the switch once the new key has run cleanly for a few days.

## 6. Notification duties

If the key could reach stored files, assistants or fine-tuning data with personal data, assess notice duties.

## Sources

- https://developers.openai.com/api/docs/guides/production-best-practices (accessed 2026-10-26)
