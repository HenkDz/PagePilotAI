import { describe, expect, it } from 'vitest';

import { buildGenerationParams } from '../../src/ai/promptBuilder.js';
import type { AiChatMessage } from '../../src/shared/types.js';

describe('promptBuilder', () => {
  it('includes selector/page context and trims prompt', () => {
    const params = buildGenerationParams({
      userPrompt: '  Please add click handler  ',
      selector: {
        id: 'sel-1',
        selector: '#cta',
        previewText: 'Call to action',
      },
      page: {
        url: 'https://example.test/product',
        title: 'Example page',
        surroundingHtml: '<div>Example</div>',
      },
    });

    expect(params.prompt).toBe('Please add click handler');
    expect(params.context?.selector?.selector).toBe('#cta');
    expect(params.context?.page?.url).toBe('https://example.test/product');
    expect(params.context?.page?.surroundingHtml).toContain('<div>Example');
  });

  it('reduces history to recent entries and adds script snippet hints', () => {
    const conversation: AiChatMessage[] = [
      {
        id: '1',
        role: 'user',
        content: 'Make it blue.',
        createdAt: Date.now() - 1000,
      },
      {
        id: '2',
        role: 'assistant',
        content: 'Applied styles.',
        createdAt: Date.now(),
        script: {
          jsCode: 'document.querySelector("#cta").style.background = "blue";',
        },
      },
    ];

    const params = buildGenerationParams({
      userPrompt: 'Now add hover state.',
      conversation,
    });

    expect(params.context?.history).toHaveLength(2);
    expect(params.context?.history?.[1]).toContain('Suggested JS: document.querySelector');
  });

  it('throws when prompt is missing', () => {
    expect(() => buildGenerationParams({ userPrompt: '   ' })).toThrowError();
  });

  it('truncates long DOM snippets to limit payload size', () => {
    const longHtml = '<div>' + 'x'.repeat(5000) + '</div>';
    const params = buildGenerationParams({
      userPrompt: 'Describe the container.',
      page: {
        url: 'https://example.test',
        surroundingHtml: longHtml,
      },
    });

    expect(params.context?.page?.surroundingHtml).toContain('<!-- truncated -->');
    expect(params.context?.page?.surroundingHtml?.length).toBeLessThan(longHtml.length);
  });
});
