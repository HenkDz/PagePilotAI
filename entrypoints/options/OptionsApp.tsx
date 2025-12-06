import { useCallback, useEffect, useMemo, useState } from 'react';
import browser from 'webextension-polyfill';
import { RuntimeMessageType } from '../../src/shared/messages';
import type { TemporaryScript, RuntimeResponse } from '../../src/shared/types';

interface EditState {
  id: string;
  jsCode: string;
  cssCode: string;
  selector: string;
  urlMatchPattern: string;
  name: string;
}

const formatRelativeTime = (timestamp: number) => {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  if (diff < 5000) return 'Just now';
  if (diff < 60000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

const OptionsApp = () => {
  const [scripts, setScripts] = useState<TemporaryScript[]>([]);
  const [filtered, setFiltered] = useState<TemporaryScript[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'disabled' | 'failed'>('all');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [savingInfo, setSavingInfo] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptListAll,
        payload: {},
      })) as { ok: boolean; payload?: { scripts: TemporaryScript[] }; error?: string };
      if (!response.ok || !response.payload) {
        setError(response.error ?? 'Unable to load scripts.');
        setScripts([]);
        return;
      }
      setScripts(response.payload.scripts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load scripts.');
      setScripts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll().catch(() => undefined);
  }, [loadAll]);

  useEffect(() => {
    const lower = query.trim().toLowerCase();
    const filteredList = scripts.filter((s) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !(s.status === 'applied' || s.status === 'pending')) return false;
        if (statusFilter === 'disabled' && s.status !== 'disabled') return false;
        if (statusFilter === 'failed' && s.status !== 'failed') return false;
      }
      if (!lower) return true;
      return (
        s.name?.toLowerCase().includes(lower) ||
        s.selector.toLowerCase().includes(lower) ||
        s.script.jsCode.toLowerCase().includes(lower) ||
        (s.script.cssCode?.toLowerCase().includes(lower) ?? false) ||
        (s.script.urlMatchPattern?.toLowerCase().includes(lower) ?? false)
      );
    });
    setFiltered(filteredList);
  }, [scripts, query, statusFilter]);

  const beginEdit = (script: TemporaryScript) => {
    setEdit({
      id: script.id,
      jsCode: script.script.jsCode,
      cssCode: script.script.cssCode ?? '',
      selector: script.selector,
      urlMatchPattern: script.script.urlMatchPattern ?? '',
      name: script.name ?? '',
    });
    setSavingError(null);
    setSavingInfo(null);
  };

  const cancelEdit = () => setEdit(null);

  const handleRemove = async (script: TemporaryScript) => {
    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptRemove,
        payload: { scriptId: script.id },
      });
    } catch (e) {
      console.warn('Removal failed', e);
    } finally {
      if (edit?.id === script.id) {
        cancelEdit();
      }
      loadAll().catch(() => undefined);
    }
  };

  const handleEnableToggle = async (script: TemporaryScript, enabled: boolean) => {
    try {
      // Get the active tab to apply the script if enabling
      let tabId: number | undefined;
      if (enabled) {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        tabId = tab?.id;
      }
      
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptToggle,
        payload: { scriptId: script.id, enabled, tabId: tabId ?? 0 },
      });
    } catch (e) {
      console.warn('Toggle failed', e);
    } finally {
      loadAll().catch(() => undefined);
    }
  };

  const handleSave = async () => {
    if (!edit) return;
    setSaving(true);
    setSavingError(null);
    setSavingInfo(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptUpdate,
        payload: {
          scriptId: edit.id,
          jsCode: edit.jsCode,
          cssCode: edit.cssCode || undefined,
          selector: edit.selector || undefined,
          urlMatchPattern: edit.urlMatchPattern || undefined,
          name: edit.name || undefined,
        },
      })) as RuntimeResponse<{ script: TemporaryScript }>;

      if (!response.ok) {
        setSavingError(response.error ?? 'Update failed.');
      } else {
        setSavingInfo('Script updated.');
        loadAll().catch(() => undefined);
      }
    } catch (e) {
      setSavingError(e instanceof Error ? e.message : 'Update failed.');
    } finally {
      setSaving(false);
    }
  };

  const activeCount = useMemo(() => scripts.filter((s) => s.status === 'applied').length, [scripts]);

  return (
    <main className="options-app">
      <header className="options-topbar">
        <h1>PagePilot Script Manager</h1>
        <p>{scripts.length} scripts · {activeCount} active</p>
        <div className="options-actions">
          <button onClick={() => loadAll()} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button onClick={() => browser.runtime.openOptionsPage?.()}>Open Options</button>
        </div>
      </header>

      <section className="options-filters">
        <input
          type="search"
          placeholder="Search scripts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
          <option value="all">All</option>
          <option value="active">Active</option>
          <option value="disabled">Disabled</option>
          <option value="failed">Failed</option>
        </select>
      </section>

      {error && <p className="message error">{error}</p>}

      <section className="options-list">
        {filtered.length === 0 && !loading && <p className="empty-state">No scripts match.</p>}
        <ul className="script-list">
          {filtered.map((script) => {
            const isActive = script.status === 'applied' || script.status === 'pending';
            const isDisabled = script.status === 'disabled';
            const isErrored = script.status === 'failed';
            return (
              <li key={script.id} className={`script-item ${edit?.id === script.id ? 'script-item-editing' : ''}`}>
                <div className="script-item-header">
                  <div className="script-item-info">
                    <span className="script-name">{script.name?.trim() || 'Untitled script'}</span>
                    <span className="script-selector" title={script.selector}>{script.selector}</span>
                    {script.script.urlMatchPattern && (
                      <span className="script-selector" title={script.script.urlMatchPattern}>{script.script.urlMatchPattern}</span>
                    )}
                  </div>
                  <div className="script-meta">
                    {isErrored && <span className="script-status script-status-error">Error</span>}
                    {isDisabled && !isErrored && <span className="script-status script-status-off">Off</span>}
                    {isActive && !isErrored && <span className="script-status script-status-on">On</span>}
                    <span className="script-updated">{formatRelativeTime(script.updatedAt)}</span>
                  </div>
                </div>
                {script.errorMessage && <p className="message error">{script.errorMessage}</p>}
                {edit?.id === script.id ? (
                  <div className="editor-fields">
                    <label className="field">
                      <span>Name</span>
                      <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>Selector</span>
                      <input value={edit.selector} onChange={(e) => setEdit({ ...edit, selector: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>URL Pattern</span>
                      <input value={edit.urlMatchPattern} onChange={(e) => setEdit({ ...edit, urlMatchPattern: e.target.value })} />
                    </label>
                    <label className="field">
                      <span>JavaScript</span>
                      <textarea
                        value={edit.jsCode}
                        onChange={(e) => setEdit({ ...edit, jsCode: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    <label className="field">
                      <span>CSS</span>
                      <textarea
                        value={edit.cssCode}
                        onChange={(e) => setEdit({ ...edit, cssCode: e.target.value })}
                        spellCheck={false}
                      />
                    </label>
                    {savingError && <p className="message error">{savingError}</p>}
                    {savingInfo && !savingError && <p className="message success">{savingInfo}</p>}
                    <div className="editor-actions">
                      <button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                      <button onClick={cancelEdit} disabled={saving}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="script-actions">
                    <button className="chip-button" onClick={() => beginEdit(script)}>Edit</button>
                    <button className="chip-button" onClick={() => handleEnableToggle(script, !isActive)} disabled={script.status === 'pending'}>
                      {isActive ? 'Disable' : 'Enable'}
                    </button>
                    <button className="chip-button ghost" onClick={() => handleRemove(script)}>Remove</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
};

export default OptionsApp;
