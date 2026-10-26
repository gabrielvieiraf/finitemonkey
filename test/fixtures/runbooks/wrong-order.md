# Stripe secret and restricted keys

Applies to rule `stripe-access-token`.

## 2. Issue the new credential

On **Developers** > **API keys**, open the menu next to the key and choose **Roll key** with expiration **Now**, or **Expire key**. A rolled key with a later expiration keeps working until then, so choose **Now** for a leaked key.

## 1. Revoke

Create a restricted key (`rk_live_`) with only the permissions the integration needs and attach an access policy (IP addresses or allowed networks) so the key works only from your servers.

## 3. Replace it in every consumer

Update the secret store or environment of every backend, worker and CI job. Webhook signing secrets are separate; roll them too if they were in the same file.

## 4. Check for misuse in the exposure window

Open the request logs for the old key in Workbench and review the window: refunds, payouts, transfers, changes to payout bank accounts, new webhook endpoints and customer data exports.

## 5. Delete the old credential after observation

If you rolled with a delay, confirm the old key's request volume stayed at zero, then let it expire or expire it now.

## 6. Notification duties

Card data never passes through your keys, but customer names, emails and addresses do. If they were read, assess notice duties under the law that applies and tell Stripe support about suspicious activity.

## Sources

- https://docs.stripe.com/keys (accessed 2026-10-26)
