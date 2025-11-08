import type { PageContextSnapshot, SelectorDescriptor, TemporaryScript } from './types';

export enum RuntimeMessageType {
  Ping = 'runtime/ping',
  SelectorCaptureStart = 'selector/capture/start',
  SelectorCaptureStop = 'selector/capture/stop',
  SelectorCaptured = 'selector/captured',
  SelectorGetActive = 'selector/get-active',
  SelectorPreviewUpdated = 'selector/preview-updated',
  TempScriptCreate = 'temp-script/create',
  TempScriptExecute = 'temp-script/execute',
  TempScriptList = 'temp-script/list',
  TempScriptRemove = 'temp-script/remove',
  TempScriptRevoke = 'temp-script/revoke',
  AiGenerate = 'ai/generate',
  AiCancel = 'ai/cancel',
}
import type {
  AiChatMessage,
  PageContextSnapshot,
  SelectorDescriptor,
  TemporaryScript,
} from './types';

export interface PingMessage {
  timestamp: number;
}

export interface SelectorCaptureCommand {
  tabId: number;
}

export interface CapturedSelectorPayload {
  descriptor: SelectorDescriptor;
  context: PageContextSnapshot;
}

export interface SelectorPreviewState {
  tabId: number;
  state?: CapturedSelectorPayload;
  isCapturing?: boolean;
}

export interface SelectorGetActivePayload {
  tabId: number;
}

export interface TempScriptCreatePayload {
  tabId: number;
  selector: string;
  jsCode: string;
  cssCode?: string;
  notes?: string;
}

export interface TempScriptRemovalPayload {
  tabId: number;
  scriptId: string;
}

export interface TempScriptListPayload {
  tabId: number;
}

export interface TempScriptListResult {
  scripts: TemporaryScript[];
}

export interface TempScriptExecutionPayload {
  script: TemporaryScript;
}

export interface TempScriptRevokePayload {
  scriptId: string;
}

export interface AiGenerateRequestPayload {
  tabId: number;
  prompt: string;
  conversation?: AiChatMessage[];
}

export interface AiGenerateResponsePayload {
  requestId: string;
  message: AiChatMessage;
}

export interface AiCancelRequestPayload {
  tabId: number;
  requestId?: string;
}

export type RuntimePayloads = {
  [RuntimeMessageType.Ping]: PingMessage;
  [RuntimeMessageType.SelectorCaptureStart]: SelectorCaptureCommand;
  [RuntimeMessageType.SelectorCaptureStop]: SelectorCaptureCommand;
  [RuntimeMessageType.SelectorCaptured]: CapturedSelectorPayload;
  [RuntimeMessageType.SelectorGetActive]: SelectorGetActivePayload;
  [RuntimeMessageType.SelectorPreviewUpdated]: SelectorPreviewState;
  [RuntimeMessageType.TempScriptCreate]: TempScriptCreatePayload;
  [RuntimeMessageType.TempScriptExecute]: TempScriptExecutionPayload;
  [RuntimeMessageType.TempScriptList]: TempScriptListPayload;
  [RuntimeMessageType.TempScriptRemove]: TempScriptRemovalPayload;
  [RuntimeMessageType.TempScriptRevoke]: TempScriptRevokePayload;
  [RuntimeMessageType.AiGenerate]: AiGenerateRequestPayload;
  [RuntimeMessageType.AiCancel]: AiCancelRequestPayload;
};
