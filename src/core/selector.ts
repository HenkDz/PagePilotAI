import type { PageContextSnapshot, SelectorDescriptor, SelectorLevel } from '../shared/types';

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

/**
 * Builds a unique selector targeting exactly this element
 */
export const computeElementSelector = (element: Element): string => {
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

/**
 * Builds a selector targeting all elements with the same class(es)
 */
export const computeClassSelector = (element: Element): string | undefined => {
  const classList = Array.from(element.classList).filter(Boolean);
  return buildClassSelector(classList);
};

/**
 * Builds a selector targeting all elements with the same tag
 */
export const computeTagSelector = (element: Element): string => {
  return element.tagName.toLowerCase();
};

/**
 * Builds a selector targeting similar elements (same tag + similar classes or attributes)
 */
export const computeSimilarSelector = (element: Element): string | undefined => {
  const tag = element.tagName.toLowerCase();
  const classList = Array.from(element.classList).filter(Boolean);
  
  // Try to find a meaningful attribute selector
  const role = element.getAttribute('role');
  if (role) {
    return `${tag}[role="${role}"]`;
  }

  const type = element.getAttribute('type');
  if (type && tag === 'input') {
    return `input[type="${type}"]`;
  }

  const dataAttrs = Array.from(element.attributes)
    .filter(attr => attr.name.startsWith('data-') && attr.value)
    .slice(0, 1);
  
  if (dataAttrs.length > 0) {
    return `${tag}[${dataAttrs[0].name}="${dataAttrs[0].value}"]`;
  }

  // Fall back to tag + first class
  if (classList.length > 0) {
    // Find the most semantic class
    const semanticClass = classList.find(cls => 
      !(/^(mt|mb|ml|mr|mx|my|pt|pb|pl|pr|px|py|w-|h-|flex|grid|text-|bg-|border-|hover:|focus:|active:)/.test(cls))
    );
    if (semanticClass) {
      return `${tag}.${escapeCss(semanticClass)}`;
    }
  }

  return undefined;
};

/**
 * Count how many elements match a selector
 */
export const countMatches = (selector: string): number => {
  try {
    return document.querySelectorAll(selector).length;
  } catch {
    return 0;
  }
};

const generateId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `selector-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const buildClassSelector = (classList: string[]): string | undefined => {
  const uniqueClasses = Array.from(new Set(classList.map((cls) => cls.trim()).filter(Boolean)));
  if (!uniqueClasses.length) {
    return undefined;
  }

  return uniqueClasses.map((name) => `.${escapeCss(name)}`).join('');
};

export const buildSelectorDescriptor = (
  element: Element,
  level: SelectorLevel = 'element',
): SelectorDescriptor => {
  const elementSelector = computeElementSelector(element);
  const classList = Array.from(element.classList).filter(Boolean);
  const selectedClasses = classList;
  const classSelector = buildClassSelector(selectedClasses);
  const tagSelector = computeTagSelector(element);
  const similarSelector = computeSimilarSelector(element);

  const alternatives = {
    element: elementSelector,
    class: classSelector,
    tag: tagSelector,
    similar: similarSelector,
  };

  // Get the active selector based on level
  let activeSelector: string;
  switch (level) {
    case 'class':
      activeSelector = classSelector ?? elementSelector;
      break;
    case 'tag':
      activeSelector = tagSelector;
      break;
    case 'similar':
      activeSelector = similarSelector ?? classSelector ?? elementSelector;
      break;
    case 'custom':
      activeSelector = elementSelector;
      break;
    case 'element':
    default:
      activeSelector = elementSelector;
      break;
  }

  return {
    id: generateId(),
    selector: activeSelector,
    previewText: summarizeText(element),
    level,
    matchCount: countMatches(activeSelector),
    alternatives,
    classList,
    selectedClasses,
    tagName: element.tagName.toLowerCase(),
  };
};

export const updateSelectorLevel = (
  descriptor: SelectorDescriptor,
  level: SelectorLevel,
  options?: { customSelector?: string; classSelection?: string[] },
): SelectorDescriptor => {
  const classSelection = options?.classSelection
    ?? descriptor.selectedClasses
    ?? descriptor.classList
    ?? [];
  const normalizedClasses = Array.from(new Set(classSelection.filter(Boolean)));
  const classSelector = buildClassSelector(normalizedClasses);
  let activeSelector: string;

  switch (level) {
    case 'class':
      activeSelector = classSelector ?? descriptor.alternatives.element;
      break;
    case 'tag':
      activeSelector = descriptor.alternatives.tag;
      break;
    case 'similar':
      activeSelector = descriptor.alternatives.similar ?? classSelector ?? descriptor.alternatives.element;
      break;
    case 'custom':
      activeSelector = options?.customSelector ?? descriptor.alternatives.element;
      break;
    case 'element':
    default:
      activeSelector = descriptor.alternatives.element;
      break;
  }

  return {
    ...descriptor,
    selector: activeSelector,
    level,
    matchCount: countMatches(activeSelector),
    selectedClasses: normalizedClasses.length ? normalizedClasses : descriptor.selectedClasses ?? [],
    alternatives: {
      ...descriptor.alternatives,
      class: classSelector ?? descriptor.alternatives.class,
    },
  };
};

export const captureContextSnapshot = (element: Element): PageContextSnapshot => {
  return {
    url: window.location.href,
    title: document.title,
    surroundingHtml: summarizeHtml(element),
  };
};

// Legacy export for backwards compatibility
export const computeCssSelector = computeElementSelector;
