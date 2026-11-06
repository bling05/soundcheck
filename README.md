# Soundcheck

Open-source security scanner for apps that are built with Lovable, Bolt, Cursor, and other AI tools.

Scan a live URL, a GitHub repo, or both. Every finding comes with evidence, an explanation, a manual fix, and a ready-to-paste AI prompt. Soundcheck is not a pentest, and every report lists what it did not check.

**Status:** early setup. Nothing can be scanned yet.

## Getting started

You need Node 24 or newer (the version we use is in `.nvmrc`).

```sh
npm install
npm run dev
```

The site runs on http://localhost:3000.

## Commands

| Command              | What it does                        |
| -------------------- | ----------------------------------- |
| `npm run dev`        | Start the website                   |
| `npm run dev:worker` | Start the scan worker in watch mode |
| `npm run build`      | Build the website for production    |
| `npm test`           | Run all tests                       |
| `npm run typecheck`  | Type-check every workspace          |
| `npm run lint`       | Run ESLint                          |
| `npm run format`     | Format the code with Prettier       |

## Layout

- `apps/web`: the Next.js website
- `apps/worker`: the scan worker
- `packages/checks`: one module per security check
- `packages/report`: finding types, severity, merging
- `packages/shared`: types and utilities used across the repo
- `fixtures`: deliberately vulnerable apps used for tests
