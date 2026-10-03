# Contributing

Thanks for looking. A bug report with a reproduction is the most useful thing you can send.

## Set up

```bash
npm ci
cp .env.example .env     # add one model key
npm run desktop
```

You need macOS 14 or later, Apple silicon, Node 24+, and the Xcode Command Line Tools.

## Before you open a pull request

```bash
npm run lint
npm run typecheck
npm run eval:injection
npm run build
```

- Keep changes small and say what you tested, and how.
- A change to anything that decides whether an action may run needs a case that fails without it. Those files are
  `src/computer-use/effects.ts`, `src/computer-use/selected-window-backend.ts`, `src/action-effects.ts`,
  `src/supervision-policy.ts`, `src/policy.ts` and `src/live-computer.ts`.
- Do not add analytics, update checks or any other network call the person did not ask for.

## About the tests

The unit tests are not in this repository yet. Many of their fixtures were recorded from real sessions, so they
are being rebuilt with synthetic pages before they are published. Until then, describe your manual check in the
pull request, and expect us to run the private suite before merging.

## Contributor agreement

Carve is AGPL-3.0, and the company also offers it under a commercial license. To keep that possible, we ask
contributors to agree to a contributor license agreement before a first pull request is merged. We will send it
to you on that pull request.

## How changes land

Development happens in a private repository that also holds the hosted service. Accepted pull requests are
applied there and appear here in the next release, credited to you.
