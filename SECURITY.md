# Security Policy

## Supported Versions

Security fixes are applied to the latest published version of Patchline. The
`1.x` line is currently supported.

## Reporting a Vulnerability

Do not report security vulnerabilities in a public issue. Use GitHub's private
security advisory workflow for this repository:

<https://github.com/demyanovvvv/opencode-patchline/security/advisories/new>

Include the affected version, operating system, OpenCode version, reproduction
steps, and the smallest available proof of impact. Do not include source files,
credentials, or other private workspace data unless it is necessary to explain
the issue.

We will acknowledge a report within 7 days and provide a status update when the
issue has been triaged. Coordinated disclosure timing is agreed with the
reporter based on severity and the availability of a fix.

## Scope

Reports involving workspace escapes, stale writes, symlink handling, protected
Git paths, encoding preservation, rollback safety, command execution, package
contents, or release authentication are in scope.
