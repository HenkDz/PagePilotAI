import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';

import './App.css';
import { defaultAiProviderConfig, runtimeEnv } from '../../src/shared/env';
import { loadAiProviderConfig, saveAiProviderConfig } from '../../src/storage/settingsStore';
import { RuntimeMessageType } from '../../src/shared/messages';
import type {
  AiProviderConfig,
  CapturedSelectorState,
  GeneratedScriptPayload,
  RuntimeMessage,
  RuntimeResponse,
  TemporaryScript,
} from '../../src/shared/types';
import type { SelectorPreviewState, AiGenerateResponsePayload } from '../../src/shared/messages';
import type { AiChatMessage } from '../../src/shared/types';

const createEmptyConfig = (): AiProviderConfig => ({
  baseUrl: defaultAiProviderConfig.baseUrl,
  apiKey: null,
  model: defaultAiProviderConfig.model,
});

type ViewMode = 'home' | 'settings';

const createLocalMessageId = () =>
  `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

const CaptureIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <circle cx="8" cy="8" r="5.5" stroke="currentColor" fill="none" strokeWidth="1.2" />
    <path d="M8 1 V4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M8 12 V15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M1 8 H4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <path d="M12 8 H15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path
      d="M9.87 2.34 9.3 3.94a3.77 3.77 0 0 1 1.55 1.06l1.58-.57.86 1.48-1.27 1.13a3.8 3.8 0 0 1 0 1.92l1.27 1.13-.86 1.48-1.58-.57a3.77 3.77 0 0 1-1.55 1.06l.57 1.6h-1.72l-.57-1.6a3.8 3.8 0 0 1-1.55-1.06l-1.58.57-.86-1.48 1.27-1.13a3.8 3.8 0 0 1 0-1.92L3.32 5.91l.86-1.48 1.58.57a3.77 3.77 0 0 1 1.55-1.06l-.57-1.6h1.72Zm-1.87 3.82a1.84 1.84 0 1 0 0 3.68 1.84 1.84 0 0 0 0-3.68Z"
      fill="currentColor"
    />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
    <path d="M4 4 L12 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M12 4 L4 12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const formatRelativeTime = (timestamp: number) => {
  if (!timestamp) {
    return '';
  }

  const now = Date.now();
  const diff = Math.max(0, now - timestamp);

  if (diff < 5000) {
    return 'Just now';
  }
  if (diff < 60000) {
    const seconds = Math.floor(diff / 1000);
    return `${seconds}s ago`;
  }
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  }
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours}h ago`;
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
    }).format(timestamp);
  } catch (error) {
    console.warn('Failed to format timestamp.', error);
    return new Date(timestamp).toLocaleDateString();
  }
};

const App = () => {
  const [view, setView] = useState<ViewMode>('home');
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [selectorState, setSelectorState] = useState<CapturedSelectorState | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [jsCode, setJsCode] = useState('');
  const [cssCode, setCssCode] = useState('');
  const [notes, setNotes] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [activeScripts, setActiveScripts] = useState<TemporaryScript[]>([]);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [isSyncingScripts, setIsSyncingScripts] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<AiProviderConfig>(createEmptyConfig);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [configStatusTone, setConfigStatusTone] = useState<'muted' | 'success' | 'error'>('muted');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isApplyingPreview, setIsApplyingPreview] = useState(false);
  const [aiConversation, setAiConversation] = useState<AiChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const aiFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (aiFeedRef.current) {
      aiFeedRef.current.scrollTop = aiFeedRef.current.scrollHeight;
    }
  }, [aiConversation]);

  useEffect(() => {
    const resolveActiveTab = async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      if (tab?.id !== undefined) {
        setActiveTabId(tab.id);
      }
      setActiveTabUrl(tab?.url ?? null);
    };

    resolveActiveTab().catch((error) => {
      console.error('Failed to resolve active tab.', error);
    });
  }, []);

  useEffect(() => {
    loadAiProviderConfig()
      .then((config) => setAiConfig(config))
      .catch((error) => {
        console.error('Failed to load AI provider config.', error);
        setAiConfig(createEmptyConfig());
      });
  }, []);

  useEffect(() => {
    if (activeTabId === null) {
      return;
    }

    const fetchSelectorState = async () => {
      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.SelectorGetActive,
          payload: { tabId: activeTabId },
        })) as { ok: boolean; payload?: { state?: CapturedSelectorState; isCapturing?: boolean }; error?: string };

        if (response?.ok && response.payload) {
          setSelectorState(response.payload.state ?? null);
          setIsCapturing(Boolean(response.payload.isCapturing));
        }
      } catch (error) {
        console.warn('Unable to fetch selector state.', error);
      }
    };

    fetchSelectorState();
  }, [activeTabId]);

  useEffect(() => {
    const handleRuntimeMessage = (message: unknown) => {
      const runtimeMessage = message as RuntimeMessage<RuntimeMessageType, unknown>;
      if (runtimeMessage.type !== RuntimeMessageType.SelectorPreviewUpdated) {
        return;
      }

      const payload = runtimeMessage.payload as SelectorPreviewState;
      if (activeTabId === null || payload.tabId !== activeTabId) {
        return;
      }

      setSelectorState(payload.state ?? null);
      setIsCapturing(Boolean(payload.isCapturing));
    };

    browser.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [activeTabId]);

  const refreshActiveScripts = useCallback(
    async (tabIdOverride?: number) => {
      const targetTabId = typeof tabIdOverride === 'number' ? tabIdOverride : activeTabId;
      if (targetTabId === null) {
        return;
      }

      setIsSyncingScripts(true);
      setScriptsError(null);
      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.TempScriptList,
          payload: { tabId: targetTabId },
        })) as { ok: boolean; payload?: { scripts: TemporaryScript[] }; error?: string };

        if (!response?.ok || !response.payload) {
          setScriptsError(response?.error ?? 'Unable to load scripts.');
          setActiveScripts([]);
          return;
        }

        setActiveScripts(response.payload.scripts);
      } catch (error) {
        console.warn('Failed to load scripts.', error);
        setScriptsError(error instanceof Error ? error.message : 'Unable to load scripts.');
        setActiveScripts([]);
      } finally {
        setIsSyncingScripts(false);
      }
    },
    [activeTabId],
  );

  useEffect(() => {
    if (activeTabId !== null) {
      refreshActiveScripts(activeTabId).catch((error) => {
        console.warn('Initial script sync failed.', error);
      });
    }
  }, [activeTabId, refreshActiveScripts]);

  useEffect(() => {
    if (view === 'home' && activeTabId !== null) {
      refreshActiveScripts(activeTabId).catch((error) => {
        console.warn('Refresh on view switch failed.', error);
      });
    }
  }, [view, activeTabId, refreshActiveScripts]);

  useEffect(() => {
    if (!selectedScriptId) {
      return;
    }
    const exists = activeScripts.some((script) => script.id === selectedScriptId);
    if (!exists) {
      setSelectedScriptId(null);
    }
  }, [activeScripts, selectedScriptId]);

  const hasCaptured = selectorState !== null;
  const selectorSummary = useMemo(() => {
    if (!selectorState) {
      return 'No element selected yet.';
    }
    return selectorState.descriptor.previewText || selectorState.descriptor.selector;
  }, [selectorState]);

  const selectedScript = useMemo(
    () => activeScripts.find((script) => script.id === selectedScriptId) ?? null,
    [activeScripts, selectedScriptId],
  );

  const activeHostname = useMemo(() => {
    if (!activeTabUrl) {
      return 'No tab detected';
    }
    try {
      return new URL(activeTabUrl).hostname;
    } catch (error) {
      console.warn('Failed to parse active tab url.', error);
      return activeTabUrl;
    }
  }, [activeTabUrl]);

  const hasAiProvider = Boolean(aiConfig.apiKey && aiConfig.apiKey.trim());

  const applyScriptPreview = useCallback(
    async (script: GeneratedScriptPayload, note?: string) => {
      if (activeTabId === null) {
        setPreviewError('Open a tab to apply preview.');
        return;
      }
      if (!selectorState) {
        setPreviewError('Capture a target element first.');
        return;
      }
      if (!script.jsCode?.trim() && !script.cssCode?.trim()) {
        setPreviewError('Generated script is empty.');
        return;
      }

      setPreviewError(null);
      setPreviewInfo(null);
      setIsApplyingPreview(true);

      if (activePreviewId) {
        try {
          await browser.runtime.sendMessage({
            type: RuntimeMessageType.TempScriptRemove,
            payload: { tabId: activeTabId, scriptId: activePreviewId },
          });
        } catch (error) {
          console.warn('Failed to clear previous preview before applying AI script.', error);
        } finally {
          setActivePreviewId(null);
        }
      }

      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.TempScriptCreate,
          payload: {
            tabId: activeTabId,
            selector: selectorState.descriptor.selector,
            jsCode: script.jsCode,
            cssCode: script.cssCode,
            notes: note,
          },
        })) as { ok: boolean; payload?: TemporaryScript; error?: string };

        if (!response?.ok || !response.payload) {
          setPreviewError(response?.error ?? 'Preview failed to apply.');
          return;
        }

        setActivePreviewId(response.payload.id);
        setPreviewInfo('Preview applied.');
        setSelectedScriptId(response.payload.id);
        setJsCode(script.jsCode ?? '');
        setCssCode(script.cssCode ?? '');
        if (typeof note === 'string') {
          setNotes(note);
        }
        await refreshActiveScripts();
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Preview failed to apply.');
      } finally {
        setIsApplyingPreview(false);
      }
    },
    [activePreviewId, activeTabId, refreshActiveScripts, selectorState],
  );

  const handleSelectScript = (script: TemporaryScript) => {
    setSelectedScriptId(script.id);
    setJsCode(script.script.jsCode ?? '');
    setCssCode(script.script.cssCode ?? '');
    setNotes(script.notes ?? '');
    setActivePreviewId(script.id);
    setPreviewError(null);
    setPreviewInfo(null);
  };

  const handleStartCapture = async () => {
    if (activeTabId === null) {
      return;
    }

    setCaptureError(null);
    try {
      const response = (await browser.runtime.sendMessage({
        type: RuntimeMessageType.SelectorCaptureStart,
        payload: { tabId: activeTabId },
      })) as { ok: boolean; error?: string };

      if (!response?.ok) {
        setCaptureError(response?.error ?? 'Failed to start capture.');
        return;
      }

      setView('home');
      setIsCapturing(true);
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Failed to start capture.');
    }
  };

  const handleStopCapture = async () => {
    if (activeTabId === null) {
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.SelectorCaptureStop,
        payload: { tabId: activeTabId },
      });
    } catch (error) {
      console.warn('Failed to stop capture.', error);
    }
    setIsCapturing(false);
  };

  const handleClearPreview = async () => {
    if (activeTabId === null || !activePreviewId) {
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptRemove,
        payload: { tabId: activeTabId, scriptId: activePreviewId },
      });
      setPreviewInfo('Preview cleared.');
      setPreviewError(null);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to clear preview.');
    } finally {
      setActivePreviewId(null);
      if (selectedScriptId && selectedScriptId === activePreviewId) {
        setSelectedScriptId(null);
      }
      refreshActiveScripts().catch((refreshError) => {
        console.warn('Failed to refresh scripts after clearing preview.', refreshError);
      });
    }
  };

  const handleApplyPreview = async () => {
    if (!hasCaptured) {
      setPreviewError('Capture a target element first.');
      return;
    }
    if (!jsCode.trim() && !cssCode.trim()) {
      setPreviewError('Add JavaScript or CSS to preview.');
      return;
    }

    await applyScriptPreview(
      {
        jsCode,
        cssCode: cssCode.trim() ? cssCode : undefined,
      },
      notes.trim() ? notes : undefined,
    );
  };

  const handleRemoveScript = async (scriptId: string) => {
    if (activeTabId === null) {
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptRemove,
        payload: { tabId: activeTabId, scriptId },
      });
      if (activePreviewId === scriptId) {
        setActivePreviewId(null);
      }
      if (selectedScriptId === scriptId) {
        setSelectedScriptId(null);
      }
      setPreviewInfo('Script removed.');
      setPreviewError(null);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to remove script.');
    } finally {
      refreshActiveScripts().catch((refreshError) => {
        console.warn('Failed to refresh scripts after removal.', refreshError);
      });
    }
  };

  const handleCaptureToggle = () => {
    if (isCapturing) {
      handleStopCapture().catch((error) => {
        console.warn('Failed to stop capture via toggle.', error);
      });
    } else {
      handleStartCapture().catch((error) => {
        console.warn('Failed to start capture via toggle.', error);
      });
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    setConfigStatus(null);
    setConfigStatusTone('muted');
    try {
      const trimmedBaseUrl = aiConfig.baseUrl.trim();
      const trimmedModel = aiConfig.model.trim();
      const trimmedKey = aiConfig.apiKey?.trim() ?? '';

      await saveAiProviderConfig({
        baseUrl: trimmedBaseUrl,
        apiKey: trimmedKey ? trimmedKey : null,
        model: trimmedModel,
      });

      setAiConfig({
        baseUrl: trimmedBaseUrl,
        apiKey: trimmedKey || null,
        model: trimmedModel,
      });
      setConfigStatus('Settings saved.');
      setConfigStatusTone('success');
    } catch (error) {
      setConfigStatus(error instanceof Error ? error.message : 'Failed to save settings.');
      setConfigStatusTone('error');
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleResetConfig = () => {
    setAiConfig(createEmptyConfig());
    setConfigStatus('Settings reset to defaults.');
    setConfigStatusTone('muted');
  };

  const handlePreviewAiScript = useCallback(
    async (message: AiChatMessage) => {
      if (!message.script) {
        setAiError('AI response did not include a script to preview.');
        return;
      }

      const text = message.content?.trim() ?? 'AI generated script';
      const noteSnippet = text.length > 80 ? `${text.slice(0, 80)}…` : text;
      await applyScriptPreview(message.script, `AI: ${noteSnippet}`);
    },
    [applyScriptPreview],
  );

  const submitPrompt = useCallback(
    async (promptText: string, history: AiChatMessage[]) => {
      const trimmed = promptText.trim();
      if (!trimmed) {
        return;
      }

      if (activeTabId === null) {
        setAiError('Open a tab before using AI assist.');
        return;
      }

      if (!hasAiProvider) {
        setAiError('Connect an AI provider in settings first.');
        return;
      }

      if (!hasCaptured) {
        setAiError('Capture an element before asking the AI.');
        return;
      }

      const userMessage: AiChatMessage = {
        id: createLocalMessageId(),
        role: 'user',
        content: trimmed,
        createdAt: Date.now(),
      };

      setAiConversation((prev) => [...prev, userMessage]);
      setAiError(null);
      setIsGeneratingScript(true);

      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.AiGenerate,
          payload: {
            tabId: activeTabId,
            prompt: trimmed,
            conversation: history,
          },
        })) as RuntimeResponse<AiGenerateResponsePayload>;

        if (response.payload?.message) {
          setAiConversation((prev) => [...prev, response.payload!.message]);
        }

        if (!response.ok) {
          const reason = response.error ?? 'AI request failed.';
          setAiError(reason);
          if (!response.payload?.message) {
            const assistantMessage: AiChatMessage = {
              id: createLocalMessageId(),
              role: 'assistant',
              content: reason,
              error: reason,
              createdAt: Date.now(),
            };
            setAiConversation((prev) => [...prev, assistantMessage]);
          }
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'AI request failed.';
        setAiError(reason);
        const assistantMessage: AiChatMessage = {
          id: createLocalMessageId(),
          role: 'assistant',
          content: reason,
          error: reason,
          createdAt: Date.now(),
        };
        setAiConversation((prev) => [...prev, assistantMessage]);
      } finally {
        setIsGeneratingScript(false);
      }
    },
    [activeTabId, hasAiProvider, hasCaptured],
  );

  const handleAiSubmit = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      const trimmed = aiInput.trim();
      if (!trimmed) {
        return;
      }

      setAiInput('');
      const history = aiConversation.slice();
      await submitPrompt(trimmed, history);
    },
    [aiConversation, aiInput, submitPrompt],
  );

  const handleAiCancel = useCallback(async () => {
    if (!isGeneratingScript || activeTabId === null) {
      return;
    }

    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.AiCancel,
        payload: { tabId: activeTabId },
      });
    } catch (error) {
      console.warn('Failed to cancel AI request.', error);
    }
  }, [activeTabId, isGeneratingScript]);

  const handleAiRegenerate = useCallback(
    async (promptText: string) => {
      const history = aiConversation.slice();
      await submitPrompt(promptText, history);
    },
    [aiConversation, submitPrompt],
  );

  return (
    <main className={`app ${view === 'settings' ? 'app-settings' : 'app-home'}`}>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">PP</span>
          <div className="brand-copy">
            <h1>PagePilot</h1>
            <p>Assistant for live page edits.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            className={`icon-button ${isCapturing ? 'icon-button-active' : ''}`}
            type="button"
            onClick={handleCaptureToggle}
            title={isCapturing ? 'Stop capture' : 'Start capture'}
            aria-label={isCapturing ? 'Stop capture' : 'Start capture'}
            disabled={activeTabId === null}
          >
            <CaptureIcon />
          </button>
          {view === 'settings' ? (
            <button
              className="icon-button"
              type="button"
              onClick={() => setView('home')}
              title="Close settings"
              aria-label="Close settings"
            >
              <CloseIcon />
            </button>
          ) : (
            <button
              className="icon-button"
              type="button"
              onClick={() => setView('settings')}
              title="Open settings"
              aria-label="Open settings"
            >
              <GearIcon />
            </button>
          )}
        </div>
      </header>

      {view === 'settings' ? (
        <section className="card settings-card">
          <div className="section-header">
            <h2>AI Provider</h2>
            <span className="section-subtitle">Configure API access for assistants.</span>
          </div>
          <label className="field">
            <span>Base URL</span>
            <input
              type="url"
              value={aiConfig.baseUrl}
              onChange={(event) => setAiConfig({ ...aiConfig, baseUrl: event.target.value })}
              placeholder="https://api.example.com/v1"
            />
          </label>
          <label className="field">
            <span>API key</span>
            <input
              type="password"
              value={aiConfig.apiKey ?? ''}
              onChange={(event) => setAiConfig({ ...aiConfig, apiKey: event.target.value })}
              placeholder="sk-***"
            />
          </label>
          <label className="field">
            <span>Model</span>
            <input
              type="text"
              value={aiConfig.model}
              onChange={(event) => setAiConfig({ ...aiConfig, model: event.target.value })}
              placeholder="gpt-4o-mini"
            />
          </label>
          {configStatus && (
            <p
              className={`message ${
                configStatusTone === 'success'
                  ? 'success'
                  : configStatusTone === 'error'
                  ? 'error'
                  : 'muted'
              }`}
            >
              {configStatus}
            </p>
          )}
          <div className="actions">
            <button className="button primary" onClick={handleSaveConfig} disabled={isSavingConfig}>
              {isSavingConfig ? 'Saving...' : 'Save settings'}
            </button>
            <button className="button ghost" onClick={handleResetConfig} disabled={isSavingConfig}>
              Reset
            </button>
          </div>
        </section>
      ) : (
        <>
          <section className="card overview-card">
            <div className="section-header">
              <h2>Current target</h2>
              <span
                className={`status-pill ${
                  isCapturing ? 'status-pill-live' : hasCaptured ? 'status-pill-ready' : 'status-pill-idle'
                }`}
              >
                {isCapturing ? 'Capturing' : hasCaptured ? 'Ready' : 'Idle'}
              </span>
            </div>
            <p className="section-subtitle">{activeHostname}</p>
            <p className="selector-preview" title={selectorState?.descriptor.selector ?? ''}>
              {selectorSummary}
            </p>
            {captureError && <p className="message error">{captureError}</p>}
            <div className="actions">
              <button
                className="button primary"
                onClick={handleStartCapture}
                disabled={isCapturing || activeTabId === null}
              >
                {hasCaptured ? 'Capture another element' : 'Capture element'}
              </button>
              <button className="button ghost" onClick={handleStopCapture} disabled={!isCapturing}>
                Stop
              </button>
            </div>
          </section>

          <section className="card scripts-card">
            <div className="section-header">
              <h2>Active scripts</h2>
              <div className="section-actions">
                <button
                  className="chip-button"
                  onClick={() => refreshActiveScripts().catch(() => undefined)}
                  disabled={isSyncingScripts}
                >
                  {isSyncingScripts ? 'Refreshing...' : 'Refresh'}
                </button>
              </div>
            </div>
            {scriptsError && <p className="message error">{scriptsError}</p>}
            {!scriptsError && activeScripts.length === 0 && !isSyncingScripts && (
              <p className="empty-state">No active previews on this page yet.</p>
            )}
            {!scriptsError && activeScripts.length > 0 && (
              <ul className="script-list">
                {activeScripts.map((script) => (
                  <li
                    key={script.id}
                    className={`script-item ${selectedScriptId === script.id ? 'script-item-selected' : ''}`}
                  >
                    <div className="script-item-top">
                      <span className={`status-pill status-${script.status}`}>
                        {script.status === 'applied'
                          ? 'Active'
                          : script.status === 'pending'
                          ? 'Pending'
                          : 'Failed'}
                      </span>
                      <span className="script-updated">{formatRelativeTime(script.updatedAt)}</span>
                    </div>
                    <p className="script-notes">{script.notes || 'No notes captured.'}</p>
                    <code className="script-selector" title={script.selector}>
                      {script.selector}
                    </code>
                    <div className="script-actions">
                      <button className="chip-button" onClick={() => handleSelectScript(script)}>
                        Manual edit
                      </button>
                      <button
                        className="chip-button ghost"
                        onClick={() => handleRemoveScript(script.id)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card editor-card">
            <div className="section-header">
              <h2>Manual preview</h2>
              {selectedScript && (
                <span
                  className="section-subtitle"
                  title={new Date(selectedScript.updatedAt).toLocaleString()}
                >
                  Editing script created {formatRelativeTime(selectedScript.updatedAt)}
                </span>
              )}
            </div>
            {!hasCaptured && (
              <p className="empty-state">Capture an element to prime the editor.</p>
            )}
            <label className="field">
              <span>JavaScript</span>
              <textarea
                value={jsCode}
                onChange={(event) => setJsCode(event.target.value)}
                placeholder="Use context elements to manipulate the selection."
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>CSS (optional)</span>
              <textarea
                value={cssCode}
                onChange={(event) => setCssCode(event.target.value)}
                placeholder="These rules apply while the preview is active."
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add context for this experiment."
              />
            </label>
            {previewError && <p className="message error">{previewError}</p>}
            {previewInfo && !previewError && <p className="message success">{previewInfo}</p>}
            <div className="actions">
              <button className="button primary" onClick={handleApplyPreview} disabled={isApplyingPreview}>
                {isApplyingPreview ? 'Applying...' : 'Apply preview'}
              </button>
              <button className="button ghost" onClick={handleClearPreview} disabled={!activePreviewId}>
                Remove preview
              </button>
            </div>
          </section>

          <section className="card ai-chat-card">
            <div className="section-header">
              <h2>AI workspace</h2>
              <span className={`status-pill ${hasAiProvider ? 'status-pill-ready' : 'status-pill-idle'}`}>
                {hasAiProvider ? 'Ready' : 'Not configured'}
              </span>
            </div>
            <p className="section-subtitle">
              Chat with PagePilot to generate scripts from your current selection.
            </p>
            <div className="ai-chat-feed" ref={aiFeedRef}>
              {aiConversation.length === 0 ? (
                <p className="empty-state">Ask PagePilot how you would like the selected element to behave.</p>
              ) : (
                aiConversation.map((message, index) => {
                  const isUser = message.role === 'user';
                  const cssSnippet = message.script?.cssCode?.trim();

                  let previousUserPrompt: string | undefined;
                  if (!isUser) {
                    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
                      const candidate = aiConversation[cursor];
                      if (candidate.role === 'user') {
                        previousUserPrompt = candidate.content;
                        break;
                      }
                    }
                  }

                  return (
                    <div
                      key={message.id}
                      className={`ai-chat-bubble ${isUser ? 'ai-chat-bubble-user' : 'ai-chat-bubble-assistant'}`}
                    >
                      <div className="ai-chat-meta">
                        <span>{isUser ? 'You' : 'PagePilot'}</span>
                        <span>{formatRelativeTime(message.createdAt)}</span>
                      </div>
                      <div className="ai-chat-content">
                        {message.content && (
                          <pre className="ai-chat-text">{message.content}</pre>
                        )}
                        {message.script && (
                          <div className="ai-script-block">
                            <div className="ai-script-header">
                              <span>Script proposal</span>
                              {message.usage?.totalTokens && (
                                <span className="ai-usage-pill">
                                  {`${message.usage.totalTokens} tokens`}
                                </span>
                              )}
                            </div>
                            <pre className="ai-script-code">{message.script.jsCode}</pre>
                            {cssSnippet && (
                              <details className="ai-css-details">
                                <summary>CSS rules</summary>
                                <pre>{cssSnippet}</pre>
                              </details>
                            )}
                            <div className="ai-script-actions">
                              <button
                                className="chip-button"
                                type="button"
                                onClick={() => handlePreviewAiScript(message)}
                                disabled={isApplyingPreview || Boolean(message.error)}
                              >
                                Preview script
                              </button>
                              {previousUserPrompt && (
                                <button
                                  className="chip-button ghost"
                                  type="button"
                                  onClick={() => handleAiRegenerate(previousUserPrompt)}
                                  disabled={isGeneratingScript}
                                >
                                  Regenerate
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {message.warnings?.map((warning) => (
                          <p key={warning} className="message muted">
                            {warning}
                          </p>
                        ))}
                        {message.error && (
                          <p className="message error">{message.error}</p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {aiError && <p className="message error">{aiError}</p>}
            <form className="ai-chat-form" onSubmit={handleAiSubmit}>
              <textarea
                className="ai-chat-input"
                value={aiInput}
                onChange={(event) => setAiInput(event.target.value)}
                placeholder={hasAiProvider ? 'Describe the change you want to see.' : 'Connect a provider in settings first.'}
                disabled={!hasAiProvider}
                spellCheck={false}
              />
              <div className="ai-chat-buttons">
                <button className="button primary" type="submit" disabled={isGeneratingScript || !hasAiProvider}>
                  {isGeneratingScript ? 'Generating…' : 'Ask PagePilot'}
                </button>
                <button className="button ghost" type="button" onClick={handleAiCancel} disabled={!isGeneratingScript}>
                  Cancel
                </button>
                <button className="chip-button ghost" type="button" onClick={() => setView('settings')}>
                  Settings
                </button>
              </div>
            </form>
          </section>
        </>
      )}

      <footer className="footer">
        <span>Mode: {runtimeEnv.mode}</span>
        <span>v{runtimeEnv.version}</span>
      </footer>
    </main>
  );
};

export default App;
