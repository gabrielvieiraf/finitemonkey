# DigitalOcean API tokens

Applies to DigitalOcean personal access tokens (`dop_v1_`) found by the generic rules.

## 1. Revoke

In the control panel, open **API** > **Tokens**, find the token and choose **Delete**, or **Regenerate** if consumers must keep the same name and scopes.

## 2. Issue the new credential

Create a token with custom scopes limited to the resources the consumer touches and an expiration date. Scopes cannot be edited later, so pick them now.

## 3. Replace it in every consumer

Update CI secrets, `doctl auth` contexts, Terraform variables and every host that used the old token.

## 4. Check for misuse in the exposure window

Review the account's security history and the resource list for the window: new Droplets, volumes, snapshots, firewall changes, new SSH keys and Spaces access keys you did not create.

## 5. Delete the old credential after observation

If you regenerated instead of deleting, confirm nothing still fails with the old value, then delete any leftover token created for the transition.

## 6. Notification duties

If Droplets or databases with personal data were reachable, assess notice duties under the law that applies to that data.

## Sources

- https://docs.digitalocean.com/reference/api/create-personal-access-token/ (accessed 2026-10-26)
