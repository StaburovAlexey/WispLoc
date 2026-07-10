# Contributing to WispLoc

Thank you for considering a contribution to WispLoc.

WispLoc is a local web UI application for processing long audio and video files. Please keep contributions aligned with the product decisions in `AGENTS.md`: local-first processing, React + TypeScript + Vite + HeroUI, Node.js/Fastify/SQLite, whisper.cpp, Ollama, and `qwen3:4b`.

## Branches

- `main` is for stable releases.
- `dev` is for active development and beta releases.
- Pull requests should target `dev` unless a maintainer asks otherwise.

## Before Opening a Pull Request

Run the fast checks:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm test:smoke
```

The normal PR checks must not download FFmpeg, Ollama, whisper models, or LLM models. Heavy setup checks are manual release checks.

## Pull Request Rules

- Keep PRs focused and reasonably small.
- Include a clear description of the change.
- Include screenshots or screen recordings for visible UI changes.
- Add or update tests when changing behavior.
- Do not introduce Python runtime requirements.
- Do not add cloud AI providers unless a maintainer explicitly approves it.
- Do not expose advanced LLM settings in the UI.
- Do not store generated media, models, logs, or local runtime data in the repository.

## Development Notes

Runtime data belongs under `~/.wisploc`, not inside the npm package or repository.

Use structured validation for LLM output. Do not trust raw model text. Keep setup and processing idempotent where possible, and preserve completed work after failures.

## Reporting Security Issues

Please do not open public issues for security vulnerabilities. Use the process in `SECURITY.md`.
