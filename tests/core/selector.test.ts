import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSelectorDescriptor, captureContextSnapshot, computeCssSelector } from '../../src/core/selector.ts';

describe('computeCssSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('returns an id-based selector when the element has an id', () => {
    const element = document.createElement('section');
    element.id = 'target-element';
    document.body.appendChild(element);

    expect(computeCssSelector(element)).toBe('#target-element');
  });

  it('builds a class-based selector with nth-of-type details for sibling collisions', () => {
    const root = document.createElement('div');
    root.id = 'root';

    const list = document.createElement('ul');
    list.className = 'list primary';

    const firstItem = document.createElement('li');
    firstItem.className = 'item';
    firstItem.textContent = 'First';

    const secondItem = document.createElement('li');
    secondItem.className = 'item special';
    secondItem.textContent = 'Second';

    list.append(firstItem, secondItem);
    root.appendChild(list);
    document.body.appendChild(root);

    expect(computeCssSelector(secondItem)).toBe('#root > ul.list.primary > li.item.special:nth-of-type(2)');
  });

  it('falls back to the tag name when the element is detached', () => {
    const element = document.createElement('span');

    expect(computeCssSelector(element)).toBe('span');
  });

  it('escapes special characters when generating id-based selectors', () => {
    const element = document.createElement('div');
    element.id = 'foo"bar baz';
    document.body.appendChild(element);

    expect(computeCssSelector(element)).toBe('#foo\\"bar\\ baz');
  });

  it('limits selector depth to six segments for deeply nested elements', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    let current = root;
    for (let index = 0; index < 7; index += 1) {
      const child = document.createElement('div');
      child.className = `level-${index}`;
      current.appendChild(child);
      current = child;
    }

    const selector = computeCssSelector(current);
    const segments = selector.split(' > ');

    expect(segments.length).toBeLessThanOrEqual(6);
    expect(segments.at(-1)).toBe('div.level-6');
  });
});

describe('buildSelectorDescriptor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('captures trimmed text content for previews', () => {
    const button = document.createElement('button');
    button.id = 'action';
    button.textContent = '  Submit form  ';
    document.body.appendChild(button);

    const descriptor = buildSelectorDescriptor(button);

    expect(descriptor.id).toBeTruthy();
    expect(descriptor.selector).toBe('#action');
    expect(descriptor.previewText).toBe('Submit form');
  });

  it('falls back to the tag name when no text content is available', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const descriptor = buildSelectorDescriptor(container);

    expect(descriptor.previewText).toBe('div');
  });

  it('truncates long previews and adds an ellipsis', () => {
    const paragraph = document.createElement('p');
    paragraph.textContent = 'a'.repeat(200);
    document.body.appendChild(paragraph);

    const descriptor = buildSelectorDescriptor(paragraph);

    expect(descriptor.previewText.length).toBe(121);
    expect(descriptor.previewText.endsWith('…')).toBe(true);
  });
});

describe('captureContextSnapshot', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    document.title = 'Test Title';
  });

  it('captures page metadata and escapes surrounding HTML', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<span data-attr="value \'quoted\'">Content</span>';
    document.body.appendChild(wrapper);

    const snapshot = captureContextSnapshot(wrapper);
    const surroundingHtml = snapshot.surroundingHtml ?? '';

    expect(snapshot.url).toBe(window.location.href);
    expect(snapshot.title).toBe('Test Title');
    expect(surroundingHtml).toMatch(/\\"/);
    expect(surroundingHtml).toMatch(/\\'/);
    expect(surroundingHtml.includes('\n')).toBe(false);
  });

  it('truncates large HTML snippets to avoid oversized payloads', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = `<p>${'a'.repeat(500)}</p>`;
    document.body.appendChild(wrapper);

    const snapshot = captureContextSnapshot(wrapper);
    const surroundingHtml = snapshot.surroundingHtml ?? '';

    expect(surroundingHtml.length).toBeGreaterThan(400);
    expect(surroundingHtml.endsWith('…')).toBe(true);
  });
});
