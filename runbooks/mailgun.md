# Mailgun API keys

Applies to Mailgun keys found by the generic rules (for example a `MAILGUN_KEY` assignment).

## 1. Revoke

In the Mailgun control panel, open **API Security** and delete the exposed account key or domain sending key.

## 2. Issue the new credential

Prefer a domain sending key, which can only send mail for one domain, over an account key. Create an account key only for tools that manage the account, with the narrowest role.

## 3. Replace it in every consumer

Update the application configuration, CI secrets and any SMTP credentials that shared the leak.

## 4. Check for misuse in the exposure window

Review sending logs and events for the window: mail you did not send, new domains, new routes or webhooks, and spikes in bounces or complaints that point to spam sent in your name.

## 5. Delete the old credential after observation

Remove any temporary key created for the switch after a few days without delivery errors.

## 6. Notification duties

If message logs or mailing lists with personal data were readable, assess notice duties. If spam went out under your domain, warn the recipients' contact point and watch your domain reputation.

## Sources

- https://documentation.mailgun.com/docs/mailgun/user-manual/api-key-mgmt/rbac-mgmt (accessed 2026-10-26)
