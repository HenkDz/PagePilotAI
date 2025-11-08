# PagePilot AI Browser Extension

PagePilot AI is a WXT-powered browser extension that lets users capture elements on any page, collaborate with an AI assistant to generate customization scripts, and persist those automations locally. This repository tracks incremental delivery of the extension from the core scaffolding through AI-assisted editing, resilience tooling, and monetization.

## Prerequisites

- [Bun](https://bun.sh/) v1.1 or newer (preferred package manager and script runner)
- Node.js 20+ (required by Bun and WXT)
- Chrome, Edge, or another Chromium-based browser for development (Firefox supported through WXT command variants)

## Quick Start

```bash
bun install
bun run dev           # Launches the extension in a Chromium-based browser
bun run dev:firefox   # Optional: run against Firefox
```

WXT opens a dedicated browser profile with hot-reload. To build production artifacts:

```bash
bun run build         # Emits dist/ with MV3 bundle
bun run zip           # Creates an upload-ready archive
```

Type-check the project at any time:

```bash
bun run compile
```

## Environment Configuration

The extension communicates with OpenAI-compatible providers. During early development the credentials are stored locally (e.g., through the extension UI), but build-time defaults help with testing:

1. Copy `.env.example` to `.env`.
2. Set the values according to your provider.

```bash
cp .env.example .env
```

| Variable | Purpose |
| --- | --- |
| `VITE_PAGEPILOT_AI_BASE_URL` | Base URL for an OpenAI-compatible endpoint. Leave empty to supply at runtime. |
| `VITE_PAGEPILOT_AI_MODEL` | Default model identifier (e.g., `gpt-4o-mini`). |

> API keys are collected through the extension UI and persisted in IndexedDB or `browser.storage.local` based on availability. They are **not** required in `.env` files.

## Project Layout

```text
docs/                  Planning artifacts and subsystem notes
entrypoints/           WXT entrypoints (background, content, popup)
src/                   Shared business logic, storage helpers, and utilities
  core/                Logging, messaging, and runtime helpers
  shared/              Shared types, constants, environment helpers
  storage/             IndexedDB abstractions and fallbacks
assets/                Static assets bundled into the extension
```

Key documents:

- `docs/detailed-plan.md` – current implementation roadmap
- `plan.md` – high-level product goals and future features

## Next Steps

- Phase 0 tasks: finalize repository layout, align on storage/AI configuration strategy, and document coding standards.
- Phase 1 will introduce the selector capture workflow and temporary script sandboxing.

Check `docs/detailed-plan.md` before starting new work to ensure changes line up with the phased roadmap.
