import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import browser from 'webextension-polyfill';

import { defaultAiProviderConfig, runtimeEnv } from '../../src/shared/env';
import { loadAiProviderConfig, saveAiProviderConfig } from '../../src/storage/settingsStore';
import { RuntimeMessageType } from '../../src/shared/messages';
import type {
  AiProviderConfig,
  CapturedSelectorState,
  GeneratedScriptPayload,
  GeneratedScriptPayload,
  RuntimeMessage,
  RuntimeResponse,
  TemporaryScript,
  SelectorLevel,
} from '../../src/shared/types';
import type { SelectorPreviewState, AiGenerateResponsePayload, GetActiveTabResult } from '../../src/shared/messages';
import type { AiChatMessage } from '../../src/shared/types';

import './SidepanelApp.css';

const createEmptyConfig = (): AiProviderConfig => ({
  baseUrl: defaultAiProviderConfig.baseUrl,
  apiKey: null,
  model: defaultAiProviderConfig.model,
});

const createLocalMessageId = () =>
  `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

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

const SELECTOR_LEVELS: { value: SelectorLevel; label: string; description: string }[] = [
  { value: 'element', label: 'This element', description: 'Target only this specific element' },
  { value: 'class', label: 'By class', description: 'All elements with the same class' },
  { value: 'tag', label: 'By tag', description: 'All elements with the same tag' },
  { value: 'similar', label: 'Similar', description: 'Elements with similar attributes' },
  { value: 'custom', label: 'Custom', description: 'Enter a custom CSS selector' },
];

type UrlScopeOption = {
  id: string;
  label: string;
  description: string;
  pattern: string;
  isDefault?: boolean;
};

const getBaseDomain = (hostname: string) => {
  const parts = hostname.split('.').filter(Boolean);
  if (parts.length <= 2) {
    return hostname;
  }
  return parts.slice(-2).join('.');
};

const buildUrlScopeOptions = (tabUrl: string | null): UrlScopeOption[] => {
  if (!tabUrl) {
    return [];
  }

  try {
    const parsed = new URL(tabUrl);
    const host = parsed.hostname;
    const origin = `${parsed.protocol}//${parsed.host}`;
    const path = parsed.pathname || '/';
    const trimmedPath = path.replace(/\/+$/, '') || '/';
    const pathPrefix = trimmedPath.includes('/') ? trimmedPath.replace(/\/[^/]*$/, '') || '/' : '/';
    const baseDomain = getBaseDomain(host);
    const options: UrlScopeOption[] = [
      {
        id: 'page',
        label: 'This page',
        pattern: `${origin}${trimmedPath}`,
        description: 'Only this exact page',
      },
      {
        id: 'path',
        label: 'This path',
        pattern: `${origin}${pathPrefix.endsWith('/') ? pathPrefix : `${pathPrefix}/`}*`,
        description: 'Any page under this path',
      },
      {
        id: 'site',
        label: 'This site',
        pattern: `${origin}/*`,
        description: 'All pages on this site (protocol locked)',
      },
      {
        id: 'domain',
        label: 'Domain',
        pattern: `*://${host}/*`,
        description: 'All pages on this domain (any protocol)',
        isDefault: true,
      },
    ];

    if (baseDomain && baseDomain !== host) {
      options.push({
        id: 'subdomains',
        label: 'Domain + subdomains',
        pattern: `*://*.${baseDomain}/*`,
        description: `Any subdomain of ${baseDomain}`,
      });
    }

    options.push({
      id: 'any',
      label: 'Any URL',
      pattern: '<all_urls>',
      description: 'Match every URL',
    });

    const seen = new Set<string>();
    return options.filter((option) => {
      if (!option.pattern || seen.has(option.pattern)) {
        return false;
      }
      seen.add(option.pattern);
      return true;
    });
  } catch {
    return [];
  }
};

// Icons
const InspectorIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="3" />
    <line x1="12" y1="2" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="22" />
    <line x1="2" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="22" y2="12" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ChevronIcon = ({ direction = 'down' }: { direction?: 'up' | 'down' }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: direction === 'up' ? 'rotate(180deg)' : undefined }}>
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CodeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6" />
    <polyline points="8 6 2 12 8 18" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" />
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const parseScriptFromContent = (content: string | undefined): GeneratedScriptPayload | null => {
  if (!content || !content.includes('jsCode')) {
    return null;
  }
  try {
    const parsed = JSON.parse(content);
    const jsCode = typeof parsed.jsCode === 'string' ? parsed.jsCode : '';
    const cssCode = typeof parsed.cssCode === 'string' ? parsed.cssCode : undefined;
    const urlMatchPattern = typeof parsed.urlMatchPattern === 'string' ? parsed.urlMatchPattern : undefined;
    if (!jsCode.trim()) {
      return null;
    }
    return { jsCode, cssCode: cssCode?.trim() ? cssCode : undefined, urlMatchPattern: urlMatchPattern?.trim() ? urlMatchPattern : undefined };
  } catch {
    return null;
  }
};

const SidepanelApp = () => {
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [activeTabUrl, setActiveTabUrl] = useState<string | null>(null);
  const [selectorState, setSelectorState] = useState<CapturedSelectorState | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);
  const [jsCode, setJsCode] = useState('');
  const [cssCode, setCssCode] = useState('');
  const [scriptName, setScriptName] = useState('');
  const [targetSelector, setTargetSelector] = useState('');
  const [urlMatchPattern, setUrlMatchPattern] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewInfo, setPreviewInfo] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [activeScripts, setActiveScripts] = useState<TemporaryScript[]>([]);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [isSyncingScripts, setIsSyncingScripts] = useState(false);
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [selectedScriptSnapshot, setSelectedScriptSnapshot] = useState<TemporaryScript | null>(null);
  const [togglingScriptId, setTogglingScriptId] = useState<string | null>(null);
  const [aiConfig, setAiConfig] = useState<AiProviderConfig>(createEmptyConfig);
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [configStatusTone, setConfigStatusTone] = useState<'muted' | 'success' | 'error'>('muted');
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isApplyingPreview, setIsApplyingPreview] = useState(false);
  const [aiConversation, setAiConversation] = useState<AiChatMessage[]>([]);
  const [aiInput, setAiInput] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);
  const [isGeneratingScript, setIsGeneratingScript] = useState(false);
  const [needsReload, setNeedsReload] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedLevel, setSelectedLevel] = useState<SelectorLevel>('element');
  const [selectedUrlScope, setSelectedUrlScope] = useState<string | null>(null);
  const [customSelector, setCustomSelector] = useState('');
  const [classSelection, setClassSelection] = useState<string[]>([]);
  const [expandedSections, setExpandedSections] = useState({
    selector: true,
    scripts: true,
    editor: false,
    chat: true,
  });

  const aiFeedRef = useRef<HTMLDivElement | null>(null);
  const lastSelectorIdRef = useRef<string | null>(null);
  const lastActiveTabIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (aiFeedRef.current) {
      aiFeedRef.current.scrollTop = aiFeedRef.current.scrollHeight;
    }
  }, [aiConversation]);

  const resetEditorState = useCallback(() => {
    setSelectedScriptId(null);
    setSelectedScriptSnapshot(null);
    setActivePreviewId(null);
    setJsCode('');
    setCssCode('');
    setScriptName('');
    setTargetSelector('');
    setUrlMatchPattern('');
    setPreviewError(null);
    setPreviewInfo(null);
  }, []);

  const checkContentReady = useCallback(async () => {
    if (activeTabId === null) {
      return;
    }

    try {
      await browser.tabs.sendMessage(activeTabId, {
        type: RuntimeMessageType.Ping,
        payload: { timestamp: Date.now() },
      } satisfies RuntimeMessage<RuntimeMessageType.Ping, { timestamp: number }>);
      setNeedsReload(false);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn('Content script ping failed; page may need reload.', reason);
      setNeedsReload(true);
    }
  }, [activeTabId]);

  // Get active tab from background
  const resolveActiveTab = useCallback(async () => {
    try {
      const response = (await browser.runtime.sendMessage({
        type: RuntimeMessageType.GetActiveTab,
        payload: {},
      })) as RuntimeResponse<GetActiveTabResult>;

      if (response?.ok && response.payload) {
        setActiveTabId(response.payload.tabId);
        setActiveTabUrl(response.payload.url);
      }
    } catch (error) {
      console.warn('Failed to resolve active tab.', error);
    }
  }, []);

  useEffect(() => {
    resolveActiveTab();
    // Re-check when the active tab finishes reloading so we can drop the warning.
    const handleTabUpdated = (tabId: number, changeInfo: browser.Tabs.OnUpdatedChangeInfoType) => {
      if (tabId !== activeTabId) {
        return;
      }
      if (changeInfo.status === 'complete') {
        checkContentReady().catch(() => setNeedsReload(true));
      }
    };

    browser.tabs.onUpdated.addListener(handleTabUpdated);
    return () => {
      browser.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, [resolveActiveTab, activeTabId, checkContentReady]);

  const syncClassSelection = useCallback((descriptor?: CapturedSelectorState['descriptor']) => {
    if (!descriptor) {
      return;
    }
    const nextSelection =
      (descriptor.selectedClasses && descriptor.selectedClasses.length > 0
        ? descriptor.selectedClasses
        : descriptor.classList) ?? [];
    setClassSelection(nextSelection);
  }, []);

  // Listen for tab changes
  useEffect(() => {
    const handleTabActivated = () => {
      resolveActiveTab();
    };

    browser.tabs.onActivated.addListener(handleTabActivated);
    return () => {
      browser.tabs.onActivated.removeListener(handleTabActivated);
    };
  }, [resolveActiveTab]);

  useEffect(() => {
    const descriptor = selectorState?.descriptor;
    const currentSelectorId = descriptor?.id ?? null;

    if (descriptor) {
      syncClassSelection(descriptor);
    }

    if (!currentSelectorId) {
      lastSelectorIdRef.current = null;
      return;
    }

    if (lastSelectorIdRef.current !== currentSelectorId) {
      lastSelectorIdRef.current = currentSelectorId;
      setExpandedSections((prev) => ({ ...prev, editor: true }));
      if (descriptor?.selector) {
        setTargetSelector(descriptor.selector);
      }
      setSelectedLevel(descriptor?.level ?? 'element');
      setUrlMatchPattern('');
    }
  }, [selectorState, syncClassSelection]);

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

    checkContentReady().catch(() => {
      setNeedsReload(true);
    });
  }, [activeTabId, checkContentReady]);

  useEffect(() => {
    const fetchSelectorState = async () => {
      if (activeTabId === null) return;
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
      if (payload.state?.descriptor) {
        setSelectedLevel(payload.state.descriptor.level);
        setTargetSelector(payload.state.descriptor.selector);
        syncClassSelection(payload.state.descriptor);
      }
    };

    browser.runtime.onMessage.addListener(handleRuntimeMessage);
    return () => {
      browser.runtime.onMessage.removeListener(handleRuntimeMessage);
    };
  }, [activeTabId, syncClassSelection]);

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
    if (activeTabId === null) {
      return;
    }
    if (lastActiveTabIdRef.current !== activeTabId) {
      resetEditorState();
    }
    lastActiveTabIdRef.current = activeTabId;
  }, [activeTabId, resetEditorState]);

  useEffect(() => {
    if (!selectedScriptId) {
      return;
    }
    const existsInScope = activeScripts.some((script) => script.id === selectedScriptId);
    if (!existsInScope) {
      resetEditorState();
    }
  }, [activeScripts, selectedScriptId, resetEditorState]);

  useEffect(() => {
    if (!selectedScriptId) {
      return;
    }
    const existing = activeScripts.find((script) => script.id === selectedScriptId);
    if (existing && existing !== selectedScriptSnapshot) {
      setSelectedScriptSnapshot(existing);
    }
  }, [activeScripts, selectedScriptId, selectedScriptSnapshot]);

  const hasCaptured = selectorState !== null;
  const selectorSummary = useMemo(() => {
    if (!selectorState) {
      return 'Click the inspector to select an element';
    }
    return selectorState.descriptor.previewText || selectorState.descriptor.selector;
  }, [selectorState]);

  const urlScopeOptions = useMemo(() => buildUrlScopeOptions(activeTabUrl), [activeTabUrl]);

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
  const activeClassSelection = useMemo(() => {
    if (!selectorState?.descriptor) {
      return [];
    }
    if (classSelection.length > 0) {
      return classSelection;
    }
    if (selectorState.descriptor.selectedClasses?.length) {
      return selectorState.descriptor.selectedClasses;
    }
    return selectorState.descriptor.classList ?? [];
  }, [classSelection, selectorState]);

  useEffect(() => {
    const trimmedPattern = urlMatchPattern.trim();

    if (urlScopeOptions.length === 0) {
      setSelectedUrlScope(trimmedPattern ? 'custom' : null);
      return;
    }

    const matched = urlScopeOptions.find((option) => option.pattern === trimmedPattern);
    if (matched) {
      setSelectedUrlScope(matched.id);
      return;
    }

    if (!trimmedPattern && !selectedScriptId) {
      const fallback = urlScopeOptions.find((option) => option.isDefault) ?? urlScopeOptions[0];
      if (fallback) {
        setUrlMatchPattern(fallback.pattern);
        setSelectedUrlScope(fallback.id);
        return;
      }
    }

    setSelectedUrlScope(trimmedPattern ? 'custom' : null);
  }, [selectedScriptId, urlMatchPattern, urlScopeOptions]);

  const handleLevelChange = useCallback(
    async (level: SelectorLevel) => {
      if (activeTabId === null || !selectorState) return;

      setSelectedLevel(level);

      if (level === 'custom') {
        return; // Don't send to content script yet, wait for custom selector input
      }

      try {
        const baseSelection =
          classSelection.length > 0
            ? classSelection
            : selectorState.descriptor.selectedClasses?.length
              ? selectorState.descriptor.selectedClasses
              : selectorState.descriptor.classList;

        await browser.runtime.sendMessage({
          type: RuntimeMessageType.SelectorSetLevel,
          payload: {
            tabId: activeTabId,
            level,
            classSelection: level === 'class' ? baseSelection : undefined,
          },
        });
      } catch (error) {
        console.warn('Failed to set selector level.', error);
      }
    },
    [activeTabId, classSelection, selectorState],
  );

  const handleCustomSelectorApply = useCallback(async () => {
    if (activeTabId === null || !customSelector.trim()) return;

    try {
      await browser.runtime.sendMessage({
        type: RuntimeMessageType.SelectorSetLevel,
        payload: { tabId: activeTabId, level: 'custom', customSelector: customSelector.trim() },
      });
    } catch (error) {
      console.warn('Failed to apply custom selector.', error);
    }
  }, [activeTabId, customSelector]);

  const handleToggleClass = useCallback(
    async (className: string) => {
      if (activeTabId === null || !selectorState) return;

      const availableClasses = selectorState.descriptor.classList ?? [];
      if (!availableClasses.includes(className)) {
        return;
      }

      const baseSelection =
        classSelection.length > 0
          ? classSelection
          : selectorState.descriptor.selectedClasses?.length
            ? selectorState.descriptor.selectedClasses
            : availableClasses;

      const nextSelection = baseSelection.includes(className)
        ? baseSelection.filter((cls) => cls !== className)
        : [...baseSelection, className];

      // Require at least one class to keep the selector meaningful
      if (nextSelection.length === 0) {
        return;
      }

      setClassSelection(nextSelection);
      setSelectedLevel('class');

      try {
        await browser.runtime.sendMessage({
          type: RuntimeMessageType.SelectorSetLevel,
          payload: { tabId: activeTabId, level: 'class', classSelection: nextSelection },
        });
      } catch (error) {
        console.warn('Failed to update class selection.', error);
      }
    },
    [activeTabId, classSelection, selectorState],
  );

  const applyScriptPreview = useCallback(
    async (script: GeneratedScriptPayload, options?: { name?: string; selector?: string; urlMatchPattern?: string }) => {
      if (activeTabId === null) {
        setPreviewError('Open a tab to apply preview.');
        return;
      }
      if (!script.jsCode?.trim() && !script.cssCode?.trim()) {
        setPreviewError('Generated script is empty.');
        return;
      }

      const selectorCandidate = options?.selector?.trim() || targetSelector.trim() || selectorState?.descriptor.selector?.trim();
      if (!selectorCandidate) {
        setPreviewError('Provide a CSS selector before applying preview.');
        return;
      }

      const patternCandidate = options?.urlMatchPattern?.trim() || script.urlMatchPattern?.trim();

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
            selector: selectorCandidate,
            jsCode: script.jsCode,
            cssCode: script.cssCode,
            name: options?.name,
            urlMatchPattern: patternCandidate,
          },
        })) as { ok: boolean; payload?: TemporaryScript; error?: string };

        if (!response?.ok || !response.payload) {
          setPreviewError(response?.error ?? 'Preview failed to apply.');
          return;
        }

        setActivePreviewId(response.payload.status === 'applied' ? response.payload.id : null);
        setPreviewInfo('Preview applied.');
        setSelectedScriptId(response.payload.id);
        setSelectedScriptSnapshot(response.payload);
        setJsCode(response.payload.script.jsCode ?? '');
        setCssCode(response.payload.script.cssCode ?? '');
        setScriptName(response.payload.name ?? options?.name ?? '');
        setTargetSelector(response.payload.selector);
        setUrlMatchPattern(response.payload.script.urlMatchPattern ?? '');
        await refreshActiveScripts();
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Preview failed to apply.');
      } finally {
        setIsApplyingPreview(false);
      }
    },
    [activePreviewId, activeTabId, refreshActiveScripts, selectorState, targetSelector],
  );

  const handleUrlScopeSelect = useCallback((option: UrlScopeOption) => {
    setUrlMatchPattern(option.pattern);
    setSelectedUrlScope(option.id);
  }, []);

  const handleSelectScript = (script: TemporaryScript) => {
    setSelectedScriptId(script.id);
    setSelectedScriptSnapshot(script);
    setJsCode(script.script.jsCode ?? '');
    setCssCode(script.script.cssCode ?? '');
    setScriptName(script.name ?? '');
    setTargetSelector(script.selector);
    setUrlMatchPattern(script.script.urlMatchPattern ?? '');
    const isActiveScript = script.status === 'applied' || script.status === 'pending';
    setActivePreviewId(isActiveScript ? script.id : null);
    setPreviewError(null);
    setPreviewInfo(null);
    setExpandedSections((prev) => ({ ...prev, editor: true }));
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

  const handleApplyPreview = async () => {
    const trimmedSelector = targetSelector.trim() || selectorState?.descriptor.selector?.trim();
    if (!trimmedSelector) {
      setPreviewError('Provide a CSS selector before applying preview.');
      return;
    }
    if (!jsCode.trim() && !cssCode.trim()) {
      setPreviewError('Add JavaScript or CSS to preview.');
      return;
    }

    const trimmedPattern = urlMatchPattern.trim();
    const trimmedJs = jsCode.trim();

    if (trimmedJs) {
      try {
        // Basic syntax validation to catch malformed user code before sending to background
        // eslint-disable-next-line no-new-func
        new Function(trimmedJs);
      } catch (error) {
        setPreviewError(
          error instanceof Error
            ? `JavaScript has a syntax error: ${error.message}`
            : 'JavaScript has a syntax error.',
        );
        return;
      }
    }

    // If a script is selected, update it instead of creating a new one
    if (selectedScriptId) {
      setPreviewError(null);
      setPreviewInfo(null);
      setIsApplyingPreview(true);

      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.TempScriptUpdate,
          payload: {
            scriptId: selectedScriptId,
            tabId: activeTabId ?? undefined,
            jsCode,
            cssCode: cssCode.trim() ? cssCode : undefined,
            selector: trimmedSelector,
            urlMatchPattern: trimmedPattern ? trimmedPattern : undefined,
            name: scriptName.trim() || undefined,
          },
        })) as RuntimeResponse<{ script: TemporaryScript }>;

        const updated = response.payload?.script;
        if (!response.ok || !updated) {
          setPreviewError(response.error ?? 'Failed to update script.');
          return;
        }

        const isActiveScript = updated.status === 'applied' || updated.status === 'pending';
        setSelectedScriptSnapshot(updated);
        setSelectedScriptId(updated.id);
        setJsCode(updated.script.jsCode ?? '');
        setCssCode(updated.script.cssCode ?? '');
        setScriptName(updated.name ?? '');
        setTargetSelector(updated.selector);
        setUrlMatchPattern(updated.script.urlMatchPattern ?? '');
        setActivePreviewId(isActiveScript ? updated.id : null);
        setPreviewError(null);
        setPreviewInfo('Script updated.');
        await refreshActiveScripts();
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Failed to update script.');
      } finally {
        setIsApplyingPreview(false);
      }

      return;
    }

    await applyScriptPreview(
      {
        jsCode,
        cssCode: cssCode.trim() ? cssCode : undefined,
        urlMatchPattern: trimmedPattern ? trimmedPattern : undefined,
      },
      {
        name: scriptName.trim() || undefined,
        selector: trimmedSelector,
        urlMatchPattern: trimmedPattern ? trimmedPattern : undefined,
      },
    );
  };

  const handleRemoveScript = async (scriptId: string) => {
    try {
      const payload: { tabId?: number; scriptId: string } = { scriptId };
      if (typeof activeTabId === 'number') {
        payload.tabId = activeTabId;
      }

      await browser.runtime.sendMessage({
        type: RuntimeMessageType.TempScriptRemove,
        payload,
      });
      if (activePreviewId === scriptId) {
        setActivePreviewId(null);
      }
      if (selectedScriptId === scriptId) {
        setSelectedScriptId(null);
        setSelectedScriptSnapshot(null);
        setJsCode('');
        setCssCode('');
        setScriptName('');
        setTargetSelector('');
        setUrlMatchPattern('');
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

  const handleToggleScript = useCallback(
    async (script: TemporaryScript, enabled: boolean) => {
      if (activeTabId === null) {
        return;
      }

      setTogglingScriptId(script.id);
      setScriptsError(null);

      try {
        const response = (await browser.runtime.sendMessage({
          type: RuntimeMessageType.TempScriptToggle,
          payload: {
            tabId: activeTabId,
            scriptId: script.id,
            enabled,
          },
        })) as RuntimeResponse<{ script: TemporaryScript }>;

        if (!response.ok) {
          setScriptsError(response.error ?? 'Unable to update script.');
        }

        await refreshActiveScripts();

        const updated = response.payload?.script;
        if (response.ok && updated) {
          if (enabled) {
            setActivePreviewId(updated.id);
            setPreviewInfo('Script enabled.');
            setPreviewError(null);
          } else {
            setPreviewInfo('Script disabled.');
            if (activePreviewId === updated.id) {
              setActivePreviewId(null);
            }
          }

          if (selectedScriptId === updated.id) {
            setJsCode(updated.script.jsCode ?? '');
            setCssCode(updated.script.cssCode ?? '');
            setScriptName(updated.name ?? '');
            setSelectedScriptSnapshot(updated);
            setTargetSelector(updated.selector);
            setUrlMatchPattern(updated.script.urlMatchPattern ?? '');
          }
        }
      } catch (error) {
        setScriptsError(error instanceof Error ? error.message : 'Unable to update script.');
      } finally {
        setTogglingScriptId(null);
      }
    },
    [activeTabId, activePreviewId, refreshActiveScripts, selectedScriptId],
  );

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

  const handlePreviewAiScript = useCallback(
    async (message: AiChatMessage) => {
      const script =
        message.script
        || parseScriptFromContent(message.content);

      if (!script) {
        setAiError('AI response did not include a script to preview.');
        return;
      }

      const truncate = (value: string) => (value.length > 72 ? `${value.slice(0, 72)}…` : value);
      const candidateName = message.suggestedName?.trim()
        || (message.promptSummary ? `AI · ${truncate(message.promptSummary.trim())}` : '')
        || (message.content?.trim() ? `AI · ${truncate(message.content.trim())}` : '');
      const finalName = candidateName || 'AI suggestion';

      const selectorOverride = targetSelector.trim() || selectorState?.descriptor.selector?.trim();
      const patternOverride = script.urlMatchPattern?.trim() || urlMatchPattern.trim() || undefined;

      await applyScriptPreview(script, {
        name: finalName,
        selector: selectorOverride || undefined,
        urlMatchPattern: patternOverride,
      });
    },
    [applyScriptPreview, selectorState, targetSelector, urlMatchPattern],
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

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  if (showSettings) {
    return (
      <main className="sidepanel">
        <header className="sidepanel-header">
          <div className="sidepanel-brand">
            <span className="sidepanel-logo">PP</span>
            <div className="sidepanel-title">
              <h1>Settings</h1>
              <span className="sidepanel-subtitle">AI Provider Configuration</span>
            </div>
          </div>
          <button className="icon-btn" onClick={() => setShowSettings(false)} title="Close settings">
            <CloseIcon />
          </button>
        </header>

        <div className="sidepanel-content">
          <section className="panel-section">
            <label className="field-group">
              <span className="field-label">Base URL</span>
              <input
                type="url"
                className="field-input"
                value={aiConfig.baseUrl}
                onChange={(e) => setAiConfig({ ...aiConfig, baseUrl: e.target.value })}
                placeholder="https://openrouter.ai/api/v1"
              />
            </label>
            <label className="field-group">
              <span className="field-label">API Key</span>
              <input
                type="password"
                className="field-input"
                value={aiConfig.apiKey ?? ''}
                onChange={(e) => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                placeholder="sk-***"
              />
            </label>
            <label className="field-group">
              <span className="field-label">Model</span>
              <input
                type="text"
                className="field-input"
                value={aiConfig.model}
                onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                placeholder="gpt-4o-mini"
              />
            </label>
            {configStatus && (
              <p className={`status-msg status-${configStatusTone}`}>{configStatus}</p>
            )}
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleSaveConfig} disabled={isSavingConfig}>
                {isSavingConfig ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </section>
        </div>

        <footer className="sidepanel-footer">
          <span>v{runtimeEnv.version}</span>
        </footer>
      </main>
    );
  }

  return (
    <main className="sidepanel">
      <header className="sidepanel-header">
        <div className="sidepanel-brand">
          <span className="sidepanel-logo">PP</span>
          <div className="sidepanel-title">
            <h1>PagePilot</h1>
            <span className="sidepanel-subtitle">{activeHostname}</span>
          </div>
        </div>
        <div className="sidepanel-actions">
          <button
            className={`icon-btn icon-btn-inspector ${isCapturing ? 'icon-btn-active' : ''}`}
            onClick={isCapturing ? handleStopCapture : handleStartCapture}
            disabled={activeTabId === null || needsReload}
            title={isCapturing ? 'Stop inspector' : 'Start inspector'}
          >
            <InspectorIcon />
          </button>
          <button className="icon-btn" onClick={() => setShowSettings(true)} title="Settings">
            <SettingsIcon />
          </button>
        </div>
      </header>

      <div className="sidepanel-content">
        {needsReload && (
          <div className="alert alert-warning">
            <span>Content script not active. </span>
            <button
              className="alert-action"
              onClick={() => {
                if (activeTabId !== null) {
                  browser.tabs.reload(activeTabId).catch(console.warn);
                }
              }}
            >
              Reload page
            </button>
          </div>
        )}

        {captureError && <div className="alert alert-error">{captureError}</div>}

        {/* Selector Section */}
        <section className="panel-section">
          <button className="section-header" onClick={() => toggleSection('selector')}>
            <div className="section-title">
              <span className="section-icon">🎯</span>
              <span>Element Selection</span>
              {selectorState && (
                <span className="badge badge-success">{selectorState.descriptor.matchCount} match{selectorState.descriptor.matchCount !== 1 ? 'es' : ''}</span>
              )}
            </div>
            <ChevronIcon direction={expandedSections.selector ? 'up' : 'down'} />
          </button>

          {expandedSections.selector && (
            <div className="section-content">
              <div className="selector-preview">
                <code>{selectorSummary}</code>
              </div>

              {hasCaptured && (
                <>
                  <div className="level-selector">
                    <span className="level-label">Selection scope:</span>
                    <div className="level-options">
                      {SELECTOR_LEVELS.map((level) => {
                        const isDisabled = level.value === 'class' && !selectorState?.descriptor.alternatives.class;
                        return (
                          <button
                            key={level.value}
                            className={`level-btn ${selectedLevel === level.value ? 'level-btn-active' : ''}`}
                            onClick={() => handleLevelChange(level.value)}
                            disabled={isDisabled}
                            title={level.description}
                          >
                            {level.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {selectedLevel === 'custom' && (
                    <div className="custom-selector-input">
                      <input
                        type="text"
                        className="field-input"
                        value={customSelector}
                        onChange={(e) => setCustomSelector(e.target.value)}
                        placeholder="Enter custom CSS selector"
                      />
                      <button className="btn btn-sm" onClick={handleCustomSelectorApply}>
                        Apply
                      </button>
                    </div>
                  )}

                  {selectorState?.descriptor.classList.length > 0 && selectedLevel === 'class' && (
                    <div className="selector-info">
                      <span className="info-label">Toggle classes:</span>
                      <div className="class-toggle-list">
                        {selectorState.descriptor.classList.map((cls) => {
                          const isActive = activeClassSelection.includes(cls);
                          return (
                            <button
                              key={cls}
                              className={`class-toggle ${isActive ? 'class-toggle-active' : ''}`}
                              onClick={() => handleToggleClass(cls)}
                            >
                              <span className="class-toggle-label">.{cls}</span>
                              <span className="class-toggle-check">{isActive ? 'On' : ''}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {selectorState?.descriptor.classList.length > 0 && selectedLevel !== 'class' && (
                    <div className="selector-info">
                      <span className="info-label">Classes:</span>
                      <div className="class-list">
                        {selectorState.descriptor.classList.slice(0, 5).map((cls) => (
                          <span key={cls} className="class-tag">.{cls}</span>
                        ))}
                        {selectorState.descriptor.classList.length > 5 && (
                          <span className="class-tag class-tag-more">+{selectorState.descriptor.classList.length - 5} more</span>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

              {!hasCaptured && !isCapturing && (
                <button
                  className="btn btn-primary btn-block"
                  onClick={handleStartCapture}
                  disabled={activeTabId === null || needsReload}
                >
                  <InspectorIcon />
                  <span>Start Inspector</span>
                </button>
              )}

              {isCapturing && (
                <div className="capture-hint">
                  <span className="pulse-dot" />
                  Click on any element to select it
                </div>
              )}
            </div>
          )}
        </section>

        {/* Scripts Section */}
        <section className="panel-section">
          <button className="section-header" onClick={() => toggleSection('scripts')}>
            <div className="section-title">
              <CodeIcon />
              <span>Scripts</span>
              <span className="badge">{activeScripts.length}</span>
            </div>
            <div className="section-actions">
              <button
                className="icon-btn icon-btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  refreshActiveScripts();
                }}
                disabled={isSyncingScripts}
                title="Refresh"
              >
                <RefreshIcon />
              </button>
              <ChevronIcon direction={expandedSections.scripts ? 'up' : 'down'} />
            </div>
          </button>

          {expandedSections.scripts && (
            <div className="section-content">
              <div className="section-scroll section-scroll-scripts">
                {scriptsError && <div className="alert alert-error">{scriptsError}</div>}

                {activeScripts.length === 0 && !isSyncingScripts && (
                  <div className="empty-state">
                    <span>No scripts for this page yet</span>
                  </div>
                )}

                <div className="script-list">
                  {activeScripts.map((script) => {
                    const isActive = script.status === 'applied' || script.status === 'pending';
                    const isToggling = togglingScriptId === script.id;

                    return (
                      <div
                        key={script.id}
                        className={`script-item ${selectedScriptId === script.id ? 'script-item-selected' : ''}`}
                      >
                        <div className="script-item-main">
                          <button
                            className={`toggle-switch ${isActive ? 'toggle-on' : ''}`}
                            onClick={() => handleToggleScript(script, !isActive)}
                            disabled={isToggling}
                          >
                            <span className="toggle-thumb" />
                          </button>
                          <div className="script-info" onClick={() => handleSelectScript(script)}>
                            <span className="script-name">{script.name || 'Untitled'}</span>
                            <span className="script-selector">{script.selector}</span>
                          </div>
                          <div className="script-meta">
                            <span className="script-time">{formatRelativeTime(script.updatedAt)}</span>
                            <button
                              className="icon-btn icon-btn-sm icon-btn-danger"
                              onClick={() => handleRemoveScript(script.id)}
                              title="Remove"
                            >
                              <CloseIcon />
                            </button>
                          </div>
                        </div>
                        {script.errorMessage && (
                          <div className="script-error">{script.errorMessage}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Editor Section */}
        <section className="panel-section">
          <button className="section-header" onClick={() => toggleSection('editor')}>
            <div className="section-title">
              <span>✏️</span>
              <span>Code Editor</span>
            </div>
            <ChevronIcon direction={expandedSections.editor ? 'up' : 'down'} />
          </button>

          {expandedSections.editor && (
            <div className="section-content">
              <div className="section-scroll section-scroll-editor">
                <label className="field-group">
                  <span className="field-label">Name</span>
                  <input
                    type="text"
                    className="field-input"
                    value={scriptName}
                    onChange={(e) => setScriptName(e.target.value)}
                    placeholder="My script"
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">Target Selector</span>
                  <input
                    type="text"
                    className="field-input field-input-mono"
                    value={targetSelector}
                    onChange={(e) => setTargetSelector(e.target.value)}
                    placeholder=".my-element"
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">URL Pattern (optional)</span>
                  <input
                    type="text"
                    className="field-input"
                    value={urlMatchPattern}
                    onChange={(e) => {
                      setUrlMatchPattern(e.target.value);
                      setSelectedUrlScope('custom');
                    }}
                    placeholder="https://example.com/*"
                  />
                </label>

                {urlScopeOptions.length > 0 && (
                  <div className="level-selector">
                    <div className="level-label-row">
                      <span className="level-label">URL scope</span>
                      <span className="level-hint">{activeHostname}</span>
                    </div>
                    <div className="level-options">
                      {urlScopeOptions.map((option) => (
                        <button
                          type="button"
                          key={option.id}
                          className={`level-btn level-btn-stack ${selectedUrlScope === option.id ? 'level-btn-active' : ''}`}
                          onClick={() => handleUrlScopeSelect(option)}
                          title={option.description}
                        >
                          <span className="level-btn-label">{option.label}</span>
                          <span className="level-btn-sub">{option.pattern}</span>
                        </button>
                      ))}
                      {selectedUrlScope === 'custom' && (
                        <span className="level-custom-chip">Custom pattern</span>
                      )}
                    </div>
                  </div>
                )}

                <label className="field-group">
                  <span className="field-label">JavaScript</span>
                  <textarea
                    className="field-textarea field-textarea-code"
                    value={jsCode}
                    onChange={(e) => setJsCode(e.target.value)}
                    placeholder="// Your code here&#10;elements.forEach(el => {&#10;  el.style.display = 'none';&#10;});"
                    spellCheck={false}
                  />
                </label>

                <label className="field-group">
                  <span className="field-label">CSS</span>
                  <textarea
                    className="field-textarea field-textarea-code"
                    value={cssCode}
                    onChange={(e) => setCssCode(e.target.value)}
                    placeholder="/* Optional CSS styles */"
                    spellCheck={false}
                  />
                </label>
              </div>

              {previewError && <div className="alert alert-error">{previewError}</div>}
              {previewInfo && !previewError && <div className="alert alert-success">{previewInfo}</div>}

              <div className="btn-row">
                <button className="btn btn-primary" onClick={handleApplyPreview} disabled={isApplyingPreview}>
                  {isApplyingPreview ? 'Applying...' : 'Apply Script'}
                </button>
              </div>
            </div>
          )}
        </section>

        {/* AI Chat Section */}
        <section className="panel-section panel-section-grow">
          <button className="section-header" onClick={() => toggleSection('chat')}>
            <div className="section-title">
              <span>🤖</span>
              <span>AI Assistant</span>
              <span className={`badge ${hasAiProvider ? 'badge-success' : 'badge-muted'}`}>
                {hasAiProvider ? 'Ready' : 'Not configured'}
              </span>
            </div>
            <ChevronIcon direction={expandedSections.chat ? 'up' : 'down'} />
          </button>

          {expandedSections.chat && (
            <div className="section-content section-content-chat">
              <div className="chat-feed" ref={aiFeedRef}>
                {aiConversation.length === 0 ? (
                  <div className="chat-empty">
                    <p>Describe what you want to do with the selected element.</p>
                    <p className="chat-hint">Examples:</p>
                    <ul className="chat-examples">
                      <li>"Hide this element"</li>
                      <li>"Change the background to blue"</li>
                      <li>"Add a red border"</li>
                      <li>"Make the font larger"</li>
                    </ul>
                  </div>
                ) : (
                  aiConversation.map((message) => {
                    const isUser = message.role === 'user';
                    const scriptCandidate = message.script ?? parseScriptFromContent(message.content);
                    const cssSnippet = scriptCandidate?.cssCode?.trim();

                    return (
                      <div
                        key={message.id}
                        className={`chat-bubble ${isUser ? 'chat-bubble-user' : 'chat-bubble-assistant'}`}
                      >
                        <div className="chat-meta">
                          <span>{isUser ? 'You' : 'PagePilot'}</span>
                          <span>{formatRelativeTime(message.createdAt)}</span>
                        </div>
                        
                        {message.content && !message.script && (
                          <pre className="chat-text">{message.content}</pre>
                        )}

                        {scriptCandidate && (
                          <div className="script-proposal">
                            <div className="script-proposal-header">
                              <span>Generated Script</span>
                              {message.usage?.totalTokens && (
                                <span className="token-badge">{message.usage.totalTokens} tokens</span>
                              )}
                            </div>
                            <pre className="script-code">{scriptCandidate.jsCode}</pre>
                            {cssSnippet && (
                              <details className="css-details">
                                <summary>CSS ({cssSnippet.split('\n').length} lines)</summary>
                                <pre className="script-code">{cssSnippet}</pre>
                              </details>
                            )}
                            <div className="script-proposal-actions">
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handlePreviewAiScript(message)}
                                disabled={isApplyingPreview || !!message.error}
                              >
                                Apply Script
                              </button>
                            </div>
                          </div>
                        )}

                        {message.error && (
                          <div className="chat-error">{message.error}</div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>

              {aiError && <div className="alert alert-error">{aiError}</div>}

              <form className="chat-form" onSubmit={handleAiSubmit}>
                <textarea
                  className="chat-input"
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  placeholder={hasAiProvider ? 'Describe what you want to change...' : 'Configure AI provider in settings'}
                  disabled={!hasAiProvider || !hasCaptured}
                  rows={2}
                />
                <div className="chat-actions">
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={isGeneratingScript || !hasAiProvider || !hasCaptured}
                  >
                    {isGeneratingScript ? 'Generating...' : 'Send'}
                  </button>
                  {isGeneratingScript && (
                    <button className="btn" type="button" onClick={handleAiCancel}>
                      Cancel
                    </button>
                  )}
                </div>
              </form>
            </div>
          )}
        </section>
      </div>

      <footer className="sidepanel-footer">
        <span>v{runtimeEnv.version}</span>
      </footer>
    </main>
  );
};

export default SidepanelApp;

