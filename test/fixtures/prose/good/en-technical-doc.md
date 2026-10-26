# Releasing

Releases are cut from `main` by semantic-release. The version comes from the commit messages since the last tag, so a `feat` commit bumps the minor version and a `fix` bumps the patch.

The release job runs only after every check passes. It builds `dist/`, compares it with the committed copy and stops if they differ, which keeps the published package identical to the reviewed code.

The retry logic is robust to a dropped connection: a failed upload is retried three times with a short wait, and the job fails with the registry's error after the third attempt.

## When a release fails

Open the failed job, read the last step's log and fix the cause in a normal PR. Do not edit the version in `package.json` by hand.
