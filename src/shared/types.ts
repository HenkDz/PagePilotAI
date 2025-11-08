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

export interface ScriptMetadata {
  id: string;
  createdAt: number;
  updatedAt: number;
  domain: string;
  label: string;
  status: 'draft' | 'active' | 'disabled';
}

export interface AiProviderConfig {
  baseUrl: string;
  apiKey: string | null;
  model: string;
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
