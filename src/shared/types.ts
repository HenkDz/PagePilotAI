export interface SelectorDescriptor {
  id: string;
  selector: string;
  previewText: string;
  framePath?: string[];
}

export interface PageContextSnapshot {
  url: string;
  title?: string;
  surroundingHtml?: string;
}

export interface GeneratedScriptPayload {
  jsCode: string;
  cssCode?: string;
  urlMatchPattern?: string;
}

export interface ModelUsageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface TemporaryScript {
  id: string;
  createdAt: number;
  updatedAt: number;
  name?: string;
  selector: string;
  context: PageContextSnapshot;
  script: GeneratedScriptPayload;
  status: 'pending' | 'applied' | 'failed' | 'disabled';
  errorMessage?: string;
}

export interface ScriptMetadata {
  id: string;
  createdAt: number;
  updatedAt: number;
  domain: string;
  label: string;
  status: 'draft' | 'active' | 'disabled';
}

export type SettingKey = 'aiProviderConfig';

export interface StoredSetting<TValue> {
  key: SettingKey;
  value: TValue;
  updatedAt: number;
}

export interface AiProviderConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
}

export type AiChatRole = 'user' | 'assistant' | 'system';

export interface AiChatMessage {
  id: string;
  role: AiChatRole;
  content: string;
  createdAt: number;
  script?: GeneratedScriptPayload;
  usage?: ModelUsageStats;
  rawText?: string;
  finishReason?: string;
  error?: string;
  warnings?: string[];
  suggestedName?: string;
  promptSummary?: string;
}

export interface AiGenerationTelemetry {
  latencyMs: number;
  usage?: ModelUsageStats;
  status: 'success' | 'error' | 'cancelled';
  error?: string;
}

export interface CapturedSelectorState {
  descriptor: SelectorDescriptor;
  context: PageContextSnapshot;
}

export interface RuntimeMessage<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}

export interface RuntimeResponse<TPayload> {
  ok: boolean;
  payload?: TPayload;
  error?: string;
}
