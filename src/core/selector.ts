import type { PageContextSnapshot, SelectorDescriptor } from '../shared/types';

const ESCAPE_REGEX = /(["'\\])/g;

const escapeCss = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (match) => `\\${match}`);
};

const summarizeText = (element: Element, maxLength = 120): string => {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!text) {
    return element.tagName.toLowerCase();
  }
  return text.length > maxLength ? `${text.slice(0, maxLength).trim()}…` : text;
};

const summarizeHtml = (element: Element, maxLength = 400): string => {
  const html = (element.outerHTML ?? '').replace(/\s+/g, ' ').trim();
  if (html.length <= maxLength) {
    return html.replace(ESCAPE_REGEX, '\\$1');
  }
  return `${html.slice(0, maxLength).replace(ESCAPE_REGEX, '\\$1')}…`;
};

const buildAncestorSegment = (element: Element): string => {
  const tag = element.tagName.toLowerCase();
  if (element.id) {
    return `#${escapeCss(element.id)}`;
  }

  let segment = tag;
  const classList = Array.from(element.classList).filter(Boolean);
  if (classList.length > 0) {
    const classes = classList.slice(0, 2).map((name) => `.${escapeCss(name)}`).join('');
    segment += classes;
  }

  const parent = element.parentElement;
  if (!parent) {
    return segment;
  }

  const siblings = Array.from(parent.children).filter((child) => child.tagName === element.tagName);
  if (siblings.length > 1) {
    const index = siblings.indexOf(element);
    segment += `:nth-of-type(${index + 1})`;
  }

  return segment;
};

export const computeCssSelector = (element: Element): string => {
  if (element.id) {
    return `#${escapeCss(element.id)}`;
  }

  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;

  while (current && depth < 6) {
    segments.unshift(buildAncestorSegment(current));
    if (current.id) {
      break;
    }
    current = current.parentElement;
    depth += 1;
  }

  if (!segments.length) {
    segments.push(element.tagName.toLowerCase());
  }

  return segments.join(' > ');
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `selector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const buildSelectorDescriptor = (element: Element): SelectorDescriptor => {
  return {
    id: generateId(),
    selector: computeCssSelector(element),
    previewText: summarizeText(element),
  };
};

export const captureContextSnapshot = (element: Element): PageContextSnapshot => {
  return {
    url: window.location.href,
    title: document.title,
    surroundingHtml: summarizeHtml(element),
  };
};
