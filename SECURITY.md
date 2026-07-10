# Security Policy

WispLoc is a local application that works with media files, local filesystem paths, external binaries, local databases, and optional integration tokens. Security reports are taken seriously.

## Supported Versions

Security fixes are handled for the latest published beta and latest stable npm release when applicable.

## Reporting a Vulnerability

Please do not create a public GitHub issue for security vulnerabilities.

Report privately through GitHub Security Advisories if enabled for the repository. If advisories are not available, contact the maintainer through the GitHub profile linked from the repository owner.

Please include:

- affected version or commit;
- operating system;
- reproduction steps;
- expected impact;
- whether local files, tokens, command execution, or network exposure are involved.

## Security Expectations

- WispLoc binds to `127.0.0.1` by default.
- Runtime files are stored under `~/.wisploc`.
- Integration tokens must not be logged or returned to the frontend in full.
- External commands must be executed with argument arrays, not shell string interpolation.
- APIs must not allow arbitrary filesystem reads outside WispLoc data directories.
