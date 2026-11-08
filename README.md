# Soundcheck

Open-source security scanner for apps that are built with Lovable, Bolt, Cursor, and other AI tools.

Scan a live URL, a GitHub repo, or both. Every finding comes with evidence, an explanation, a manual fix, and a ready-to-paste AI prompt. Scans are deterministic and do not use an LLM, and every report lists what it did not check.

**Status:** in development, live at https://soundcheck-lovat.vercel.app. Website scans run eight checks: security headers, secret keys in public code, leftover files, outdated Next.js, and AI services called from the browser for anyone, plus Supabase tables, Supabase file storage, and Firebase databases anyone can read for owners who verify their site. Repo scans aren't built yet.

## Getting started

You need Node 24 or newer (the version we use is in `.nvmrc`) and a Postgres database. We use a free [Neon](https://neon.com) project.

Create a `.env` file in the repo root. It's gitignored, so never commit it.

```sh
DATABASE_URL=postgresql://...     # your Postgres connection string
SCAN_LIMIT_SECRET=...             # any long random string
CRON_SECRET=...                   # any long random string
```

Then:

```sh
npm install
npm run db:migrate
npm run dev
```

The site runs on http://localhost:3000. Scans run inside the website, so there's nothing else to start.

## Commands

| Command              | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev`        | Start the website                                       |
| `npm run db:migrate` | Set up or update the database tables                    |
| `npm run build`      | Build the website for production                        |
| `npm run self-check` | Scan a running local build with Soundcheck's own checks |
| `npm test`           | Run all tests                                           |
| `npm run typecheck`  | Type-check every workspace                              |
| `npm run lint`       | Run ESLint                                              |
| `npm run format`     | Format the code with Prettier                           |

## Layout

- `apps/web`: the Next.js website
- `packages/checks`: one module per security check, plus the code that runs a whole scan
- `packages/report`: finding types, severity, merging
- `packages/shared`: types and utilities used across the repo
- `packages/db`: database access and migrations
- `fixtures`: deliberately vulnerable apps used for tests

## License

[MIT](LICENSE)
