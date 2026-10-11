# Repository Guidelines

## Project Structure & Module Organization

This repository is a TypeScript Turborepo monorepo: `apps/web` contains the React/Vite client, `apps/api` the Express/Socket.IO service and PostgreSQL schema/migrations, `packages/shared` runtime schemas and shared game rules, and `tests/e2e` Playwright browser checks. Keep app code in each package’s `src/`; do not commit build output or environment files.

## Build, Test, and Development Commands

Use `docker compose up -d db` for local PostgreSQL, copy `apps/api/.env.example` to `apps/api/.env`, wait for `db` to report `healthy` in `docker compose ps`, then run `pnpm db:migrate` and `pnpm dev`. `docker compose up --build` starts the complete local stack. Run `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm test:e2e` for the corresponding checks; the browser test expects the web app at `http://localhost:5173` unless `PLAYWRIGHT_BASE_URL` is set.

## Coding Style & Naming Conventions

Use TypeScript throughout and format with Prettier using two-space indentation. Keep React components in PascalCase, hooks/functions in camelCase, and shared schemas/types in descriptive names. Validate API and socket inputs with Zod; do not treat TypeScript types as runtime validation.

## Testing Guidelines

Keep focused Vitest unit tests beside shared rules and Playwright browser scenarios in `tests/e2e/*.spec.ts`. Run the declared scripts above when changing behavior; no coverage threshold is configured.

## Commit & Pull Request Guidelines

Git history is unavailable in this checkout, so existing commit conventions cannot be confirmed. Use short, imperative commit subjects; a scoped prefix such as `docs:`, `fix:`, or `feat:` is a useful default. Pull requests should explain the change and how it was checked, link related issues when applicable, and include screenshots for visible UI changes.

## Security & Configuration

Treat all API and socket input as untrusted and validate it at runtime. Enforce role and station scope on the server, hash credentials, and rate-limit authentication. Keep secrets in environment variables; do not commit `.env` files or log credentials, session values, or sensitive data.

Use parameterized Drizzle queries; avoid `eval`/`Function` and shell strings built from user input. The production client and API share one origin. Railway secrets must use unique production values; local Compose defaults are for development only. Indivisa font files remain excluded until web use is approved.
