# Security policy

Analyticool is a bootstrap prototype. Only the latest default-branch code is maintained; there are no supported production releases. The demo uses synthetic records and requires no credentials or external connections.

## Report privately

Use GitHub's **Report a vulnerability** option under the repository's Security tab:

https://github.com/bernacle/analyticool/security/advisories/new

If private reporting is unavailable, open an issue titled **Request a private security reporting channel**, without vulnerability details, credentials, or exploit code. A maintainer should arrange a private channel before you share details. Availability depends on repository settings.

Include affected versions/commits, potential impact, and reproduction steps using synthetic data. Please allow maintainers to investigate and coordinate a fix before public disclosure. This volunteer project does not promise a response SLA.

## Trust boundaries

- Core validates records and metric semantics; it does not authorize data.
- The demo selects a fixed fictional workspace in app code. It accepts no tenant identifiers, SQL, database URLs, or execution requests from clients.
- Client approval is a demonstration, not a security control or durable record.
- Never attach production databases to this demo. Real connectors require server-side authorization, isolation, read-only execution controls, and secret management before use.

Revoke or rotate exposed credentials promptly. Deleting a secret from a file does not remove it from history.
