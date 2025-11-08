# Selector Capture & Preview Notes

Last updated: 2025-11-08

## Current Capabilities

- **Selector capture loop** runs in `entrypoints/content.ts`, exposing start/stop commands, overlay highlighting, and `SelectorCaptured` lifecycle messaging back to the background service worker.
- **Temporary preview execution** leverages `src/core/pagePilot.ts` to inject JS/CSS for the captured selector, track cleanup callbacks, and revoke previews on demand.
- **Popup control surface** (`entrypoints/popup/App.tsx`) now orchestrates capture start/stop, displays selector summaries, and lets users submit JS/CSS snippets for live preview, falling back to inline messaging when operations fail.
- **Temporary script persistence** is coordinated by `entrypoints/background.ts` through `saveTemporaryScript` / `removeTemporaryScript`, recording status transitions (`pending → applied/failed`) and reusing captured context snapshots.
- **AI provider settings** are surfaced in the popup and stored via `src/storage/settingsStore.ts`, keeping trimmed values in IndexedDB or the storage fallback.

## Message Flow Reference

| Message | Emitter | Recipient | Purpose |
| --- | --- | --- | --- |
| `selector/capture/start` | Popup | Content | Begin hover + highlight capture loop. |
| `selector/capture/stop` | Popup | Content | Cancels capture loop and removes overlay. |
| `selector/captured` | Content | Background | Persists descriptor/context and broadcasts state to popup. |
| `selector/preview-updated` | Background | Popup | Keeps popup in sync with capturing status and last selection. |
| `temp-script/create` | Popup | Background → Content | Persists and injects temporary preview scripts, returning status to popup. |
| `temp-script/remove` | Popup | Background → Content | Revokes and deletes persisted preview scripts. |

## How To Build & Test

```shell
bun run build
```

The build bundles updated background/content/popup code paths and ensures TypeScript stays aligned.

## Follow-Up Opportunities

1. **AI integration:** connect popup preview requests to the forthcoming `src/ai/modelClient.ts` once available, feeding selector context into prompts and handling streaming responses.
2. **Preview diagnostics:** surface execution logs or cleanup reminders when user scripts fail or leave residual DOM state.
3. **Context enrichment:** extend `CapturedSelectorState` with DOM breadcrumbs or attribute metadata to improve AI and manual scripts.
4. **Formal tests:** add unit coverage for `src/core/selector.ts` and preview lifecycle helpers (`pagePilot.ts`).
