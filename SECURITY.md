# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub security advisories:

https://github.com/gabrielvieiraf/finitemonkey/security/advisories/new

Do not open a public issue, pull request or discussion for a security problem. Do not include real secrets in the report; describe where a secret appears (file and line) instead of pasting its value.

Include what you can: the affected version, your platform, the steps to reproduce, what you expected and what happened. You will get an acknowledgement, and the fix will be coordinated with you before anything is made public.

## Supported versions

Finite Monkey is pre-release. No version is supported yet. Version `0.0.0` on npm is a name reservation and contains no code. Once releases start, security fixes go to the latest stable version.

## Design commitments (planned)

These describe how Finite Monkey is being built. Each one will be backed by a test before it is claimed as true for a release.

- Nothing leaves the user's machine by default. No telemetry.
- Secrets are never printed in output, logs, reports or pull requests; they are referenced by file and line.
- Guards fail closed: if a check cannot run, the action is blocked and the reason is shown.
- Packages are published only from CI, with npm provenance.
- A generated list of exactly what Finite Monkey reads, writes and sends over the network will be added to this file before the first release.
