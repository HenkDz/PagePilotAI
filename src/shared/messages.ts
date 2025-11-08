export enum RuntimeMessageType {
  Ping = 'runtime/ping',
  SelectorCaptured = 'selector/captured',
}

export interface PingMessage {
  timestamp: number;
}

export interface SelectorCapturedMessage {
  selector: string;
  elementHtml?: string;
  url: string;
}

export type RuntimePayloads = {
  [RuntimeMessageType.Ping]: PingMessage;
  [RuntimeMessageType.SelectorCaptured]: SelectorCapturedMessage;
};
