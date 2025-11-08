# PagePilot AI Detailed Implementation Plan

This document lays out an incremental delivery roadmap that keeps extension context manageable while layering capabilities. Each phase produces usable artifacts and the foundations for the next phase. The WXT framework handles browser parity, so the plan focuses on UX, IndexedDB persistence, and OpenAI-compatible AI integration (custom base URL + API key).

---

## Phase 0 – Project Enablement (1-2 sprints)

**Summary:** Establish a predictable extension baseline, shared tooling, and product assumptions so future iterations plug into a stable foundation.

- **Goals**
  - Finalize repository structure: `entrypoints/`, `src/core/`, `src/ai/`, `src/storage/`, `assets/`, `docs/`.
  - Harden WXT configuration (`wxt.config.ts`) and permissions, ensuring messaging, storage, and scripting scopes are defined.
  - Document local development commands, lint/test scripts, and release flow in `README.md` and this plan.
  - Define configuration surfaces for OpenAI-compatible endpoints (base URL + API key) and feature flags for AI usage.
  - Decide IndexedDB schema strategy and fallback to `browser.storage.local` for unsupported contexts.
- **Deliverables**
  - Updated documentation covering architecture overview, coding conventions, and environment variable usage for AI providers.
  - Base utility modules (`src/core/logger.ts`, `src/shared/types.ts`) and messaging helpers wired between popup, background, and content scripts.
  - Initial IndexedDB bootstrap (`src/storage/indexedDb.ts`) with version management stubs and smoke tests.
  - Storage schema reference (`docs/storage.md`) outlining IndexedDB stores and fallbacks.
  - `bun dev` and `bun run build` succeed without warnings; lint/test automation exists even if minimal.
  - Team alignment captured on storage choices, AI configuration flow, and security/privacy guardrails.

---

## Phase 1 – Selector Capture & Sandbox Injection (2-3 sprints)

**Summary:** Ship the non-AI editing loop: capture DOM targets, inject temporary scripts, and persist session state via IndexedDB.

- **Goals**
  - Build hover/click selector capture in `entrypoints/content.ts`, including visual highlight overlay and resilient selector heuristics.
  - Implement temporary script registry in `entrypoints/background.ts` backed by IndexedDB, with lifecycle events for load/unload.
  - Create PagePilot wrapper (`src/core/pagePilot.ts`) handling sandboxed execution, MutationObserver setup, and element polling utilities.
  - Extend popup UI to display captured selector, accept manual JS/CSS, and trigger temporary injections for live preview.
- **Deliverables**
  - Content/background/popup messaging pipeline with type-safe payloads and error handling.
  - IndexedDB data model for temporary scripts, including schema migration tests and fallback path to `browser.storage.local`.
  - Manual preview workflow documented, demonstrating injection and rollback.
- **Exit Criteria**
  - Users can capture an element, inject custom JS via popup, view immediate changes, and remove the script within the session.
  - IndexedDB operations verified in Chromium-based browsers; fallback path tested for environments lacking IndexedDB.

---

## Phase 2 – AI-Assisted Editing Loop (3-4 sprints)

**Summary:** Layer in AI chat flow that generates sandboxed scripts using configurable OpenAI-compatible endpoints while reusing Phase 1 plumbing.

- **Goals**
  - Develop AI client (`src/ai/modelClient.ts`) supporting custom base URL + API key, request retries, and streaming responses when available.
  - Author prompt templates that include selector context, surrounding DOM, prior attempts, and enforce vanilla JS + MutationObserver usage.
  - Upgrade popup UI into chat workspace with transcripts, context pills, regenerate/accept controls, and settings modal for AI credentials.
  - Validate generated payloads (JSON with `js_code`, `css_code`, `url_match_pattern`) before injection; surface error states clearly.
  - Capture local-only telemetry for AI latency, token usage estimates, and failure diagnostics.
- **Deliverables**
  - Secure credential storage leveraging IndexedDB (or encrypted `browser.storage.local`) and runtime configuration guards.
  - Background job manager that queues AI calls, supports cancellation, and throttles requests to respect provider limits.
  - Updated PagePilot wrapper integrating safety checks, sandbox injection, and status callbacks to popup.
- **Exit Criteria**
  - End-to-end flow: user selects DOM target → requests AI script → preview auto-injects → user iterates or approves → optional save to temporary registry.
  - Automated tests cover prompt formatting, response parsing, injection validation, and credential handling.

---

## Phase 3 – Persistence, History, and Robustness (3-4 sprints)

**Summary:** Convert the sandbox into a durable rule engine with history, healing, and diagnostics so users can rely on saved automations.

- **Goals**
  - Extend IndexedDB schema for durable rules, version history, execution logs, and metadata (domain, timestamps, model used).
  - Implement selector repair service with heuristics and optional AI assistance using stored DOM snapshots.
  - Enhance PagePilot wrapper with Shadow DOM, iframe, and dynamic content handling (configurable observers and polling strategies).
  - Build management UI (popup or dedicated panel) for enabling/disabling rules, viewing diffs, and rolling back versions.
  - Instrument structured logging for runtime errors with safe surfacing in the popup diagnostics view.
- **Deliverables**
  - Persistent rule store module (`src/storage/ruleStore.ts`) with migration scripts and tests.
  - UI components for history list, rule details, execution log viewer, and selector repair prompts.
  - Documentation on recovery workflows and troubleshooting saved rules.
- **Exit Criteria**
  - Saved rules automatically run on matching pages, with visible toggles and rollback options.
  - Selector repair flow demonstrably recovers from a simulated DOM change, and regression tests protect IndexedDB migrations.

---

## Phase 4 – Security, Monetization, and Scale (ongoing)

**Summary:** Prepare for broader release by tightening security, introducing freemium controls, and planning for backend expansion if needed.

- **Goals**
  - Provide script transparency (pre-save diff/preview), confirmation prompts, and user-level kill switch.
  - Conduct content security review, harden sandbox boundaries, and add optional logging redaction for privacy.
  - Introduce freemium enforcement (e.g., limit number of active AI-generated rules) with upgrade prompts and usage tracking.
  - Assess backend/API requirements for syncing rules, enforcing quotas, or collaborative features; design migration path if adopting cloud storage.
  - Produce documentation for incident response, data export/import, and privacy policies.
- **Deliverables**
  - Settings UI for plan management, rule export/import, and kill switch.
  - Security checklist and automated lint/static checks for dangerous patterns in generated scripts.
  - Product collateral (landing page outline, demo scripts) aligned with monetization strategy.
- **Exit Criteria**
  - Extension passes security audit, and freemium gating works with local feature flags ready for experimentation.
  - Backend integration plan captured (API endpoints, auth, data migration), even if not implemented yet.

---

## Cross-Phase Practices

- Maintain concise subsystem docs (`docs/selector.md`, `docs/storage.md`, `docs/ai-integration.md`) to summarize stable knowledge for future AI prompts.
- Track prompt/response transcripts for successful edits to seed evaluation datasets and regression tests.
- Use automated formatting, linting, and tests to generate deterministic artifacts for AI-assisted development and code review.
- Update this plan after each phase with retrospectives, risks, and timeline adjustments.
