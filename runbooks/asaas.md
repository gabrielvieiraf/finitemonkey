# Asaas API keys

Applies to rule `asaas-api-key`.

## 1. Revoke

As an account administrator, open **Integrações** in the web interface and delete the exposed key. A deleted key cannot be restored. A parent account can also revoke a subaccount key through the API.

## 2. Issue the new credential

Create the new key in the same area. Use a separate key per subaccount and per environment, and never put a production key in a sandbox configuration.

## 3. Replace it in every consumer

Update the backend secret store, CI secrets and every worker that calls the API.

## 4. Check for misuse in the exposure window

Review charges, transfers, PIX keys, bank account changes and webhook settings for the window, in the account and in every subaccount the key could reach.

## 5. Delete the old credential after observation

If you created a temporary key during the switch, delete it after a few days without errors.

## 6. Notification duties

Asaas keys reach customer names, tax ids and payment data. If they were read, assess notice duties under the LGPD toward the ANPD and the people affected.

## Sources

- https://docs.asaas.com/docs/chaves-de-api (accessed 2026-10-26)
