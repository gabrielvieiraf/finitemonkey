# AWS access keys

Applies to rules `aws-access-token` and `aws-secret-access-key`.

## 1. Revoke

In the IAM console, open the user, then **Security credentials** > **Access keys**, and set the exposed key to **Inactive** (`aws iam update-access-key --access-key-id <id> --status Inactive --user-name <user>`). Inactive keys stop signing requests at once and can still be turned back on if something critical breaks.

## 2. Issue the new credential

Prefer no long-lived key at all: an IAM role for EC2, ECS or Lambda, or OIDC federation for CI (GitHub Actions `aws-actions/configure-aws-credentials` with a role). If a key is unavoidable, create it on a user whose policy grants only what the consumer needs (`aws iam create-access-key --user-name <user>`).

## 3. Replace it in every consumer

Update the secret store, CI secrets, `.env` files outside git, and every host that had the old key. Restart the processes that read it at start.

## 4. Check for misuse in the exposure window

Run `aws iam get-access-key-last-used --access-key-id <id>` and search CloudTrail for the key id from the first exposure until it went inactive. Look for new IAM users, new keys, new regions, EC2 instances you did not start and S3 reads you do not recognize.

## 5. Delete the old credential after observation

After a few days with no errors from consumers and no use of the old id, delete it (`aws iam delete-access-key --access-key-id <id> --user-name <user>`).

## 6. Notification duties

If CloudTrail shows access to personal data, the data protection law that applies (LGPD, GDPR or a state law) may require notice to the regulator and to the people affected. Record what was reachable with the key and decide with whoever owns that duty.

## Sources

- https://docs.aws.amazon.com/IAM/latest/UserGuide/id-credentials-access-keys-update.html (accessed 2026-10-26)
- https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_access-keys.html (accessed 2026-10-26)
