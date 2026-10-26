# Database and Redis passwords

Applies to rules `credential-in-url`, `password-assignment` and `secret-in-process-args` when the value is a database or Redis password.

## 1. Revoke

PostgreSQL: `ALTER ROLE <role> WITH PASSWORD NULL;` or `ALTER ROLE <role> NOLOGIN;` until the new password is in place. MySQL: `ALTER USER '<user>'@'<host>' ACCOUNT LOCK;`. Redis with ACLs: remove the password from the user (`ACL SETUSER <user> <<old-password>`), or with `requirepass` change it in the config and restart.

## 2. Issue the new credential

Generate a long random password (`ACL GENPASS` in Redis, `openssl rand -base64 32` elsewhere), or move to IAM database authentication or short-lived credentials from a secrets manager. Give each application its own role with only the grants it needs.

## 3. Replace it in every consumer

Update connection strings in the secret store, compose files (from a variable, never a literal argument), CI, migrations and backup jobs. Restart connection pools.

## 4. Check for misuse in the exposure window

Check the server log for logins from unknown addresses, `pg_stat_activity` or `SHOW PROCESSLIST` for unknown sessions, and look for new roles, changed grants, dropped tables or large reads. Check whether the port was reachable from the internet during the window.

## 5. Delete the old credential after observation

Remove temporary roles or extra Redis passwords added for the switch after the applications have run cleanly for a few days.

## 6. Notification duties

A database usually holds personal data. If anyone outside your team could have connected, treat it as a possible breach and assess notice duties toward the regulator and the people affected.

## Sources

- https://www.postgresql.org/docs/17/sql-alterrole.html (accessed 2026-10-26)
- https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/ (accessed 2026-10-26)
