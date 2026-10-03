# Security

Carve holds two powerful macOS permissions, Screen Recording and Accessibility. A way to make it act outside the
window you chose, act on an instruction that came from screen content, type a credential, or skip an approval is a
security bug, and it is the kind of report we most want.

## Reporting

Use **Security → Report a vulnerability** on this repository (GitHub private vulnerability reporting). If you cannot
use GitHub, write to support@getcarve.app with "Security" in the subject.

Please do not open a public issue for a vulnerability before it is fixed.

## What to include

- The version or commit, your macOS version, and the model provider you used.
- The steps, page or file that reproduces it. A failing case for `npm run eval:injection` is ideal.
- What Carve did, and what it should have done.

## What to expect

We aim to acknowledge a report within two working days and to tell you what we found within seven. Fixes ship in
the next release with credit to the reporter, unless you would rather not be named.

## Scope

In scope: this repository, and the signed builds published on its Releases page.
Out of scope: the hosted service at getcarve.app (report those to support@getcarve.app), and model-provider
behaviour that Carve's gates already refuse.

The design and its known limits are described in [docs/security-model.md](docs/security-model.md).
