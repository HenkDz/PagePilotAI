import type {
  AiChatMessage,
  PageContextSnapshot,
  SelectorDescriptor,
} from '../shared/types';
import type { GenerateScriptParams } from './modelClient';

export interface PromptBuilderInput {
  userPrompt: string;
  selector?: SelectorDescriptor;
  page?: PageContextSnapshot;
  conversation?: AiChatMessage[];
  responseFormat?: 'json' | 'text';
  temperature?: number;
  maxOutputTokens?: number;
}

const DEFAULT_DOM_SNIPPET_LIMIT = 4000;

const truncate = (value: string, limit = DEFAULT_DOM_SNIPPET_LIMIT): string => {
  if (!value || value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit)}\n<!-- truncated -->`;
};

const normalisePageContext = (page?: PageContextSnapshot): PageContextSnapshot | undefined => {
  if (!page) {
    return undefined;
  }

  const snapshot: PageContextSnapshot = {
    url: page.url,
    title: page.title,
  };

  if (page.surroundingHtml?.trim()) {
    snapshot.surroundingHtml = truncate(page.surroundingHtml.trim());
  }

  return snapshot;
};

const normaliseHistory = (conversation?: AiChatMessage[]): string[] | undefined => {
  if (!conversation || conversation.length === 0) {
    return undefined;
  }

  const history = conversation
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .slice(-8)
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      const parts = [`${role}: ${message.content.trim()}`];
      if (message.script?.jsCode?.trim()) {
        const snippet = message.script.jsCode.length > 240
          ? `${message.script.jsCode.slice(0, 240)}…`
          : message.script.jsCode;
        parts.push(`Suggested JS: ${snippet}`);
      }
      if (message.error) {
        parts.push(`Error: ${message.error}`);
      }
      return parts.join('\n');
    });

  return history.length > 0 ? history : undefined;
};

export const buildGenerationParams = (input: PromptBuilderInput): GenerateScriptParams => {
  if (!input.userPrompt?.trim()) {
    throw new Error('Prompt text is required to build generation payload.');
  }

  return {
    prompt: input.userPrompt.trim(),
    context: {
      selector: input.selector,
      page: normalisePageContext(input.page),
      history: normaliseHistory(input.conversation),
    },
    responseFormat: input.responseFormat ?? 'json',
    temperature: input.temperature ?? 0.2,
    maxOutputTokens: input.maxOutputTokens,
  } satisfies GenerateScriptParams;
};

export const promptBuilder = {
  build: buildGenerationParams,
};
