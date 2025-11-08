# Storage Architecture

PagePilot AI stores user data locally by default. IndexedDB is the primary persistence layer to keep AI-generated scripts and settings near the background service worker. When IndexedDB is unavailable (e.g., hardened browser profile, extension debugging tools), the extension transparently falls back to `browser.storage.local`.

## Databases & Stores

### IndexedDB Database: `pagepilot-ai`

| Store | Key Path | Purpose |
| --- | --- | --- |
| `tempScripts` | `id` | Volatile scripts created during the live preview loop. Records include selector context, generated code, and status metadata. |
| `settings` | `key` | Application settings such as AI provider configuration and future feature flags. |

### Fallback Namespace

When IndexedDB operations fail, data is written to the following keys inside `browser.storage.local`:

- `pagepilot.tempScripts`
- `pagepilot.settings`

Each fallback entry mirrors the IndexedDB schema so that migration between persistence layers is seamless.

## Data Shapes

### Temporary Script

```ts
interface TemporaryScript {
  id: string;
  createdAt: number;
  updatedAt: number;
  selector: string;
  context: PageContextSnapshot;
  script: GeneratedScriptPayload;
  status: 'pending' | 'applied' | 'failed';
  errorMessage?: string;
  notes?: string;
}
```

Temporary scripts are cleared when the user dismisses the preview or saves the script permanently.

### AI Provider Configuration

```ts
interface AiProviderConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}
```

Settings are versioned with `updatedAt` timestamps so future migrations can detect stale records.

## Access Helpers

- `src/storage/indexedDb.ts` – Opens the database, exposes `withStore`, converts `IDBRequest` objects into promises, and clears the DB when needed.
- `src/storage/tempScriptStore.ts` – CRUD helpers for temporary scripts with IndexedDB-or-storage.local fallback logic.
- `src/storage/settingsStore.ts` – Settings persistence for AI provider credentials and defaults.

## Security Notes

- API keys remain on-device; they are only stored after explicit user consent.
- Future sync features will require an explicit migration path away from browser-managed storage.
- Clear the database with `clearTemporaryScripts` (temporary data) or `clearAiProviderConfig` (sensitive settings) during troubleshooting workflows.
