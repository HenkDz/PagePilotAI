import type { GeneratedScriptPayload } from '../shared/types';

export interface ScriptValidationResult {
  ok: boolean;
  script?: GeneratedScriptPayload;
  errors: string[];
  warnings: string[];
}

const MAX_JS_LENGTH = 8000;
const MAX_CSS_LENGTH = 4000;

const containsDisallowedPatterns = (code: string): string[] => {
  const warnings: string[] = [];

  const patterns = [
    { regex: /fetch\s*\(/i, message: 'Uses fetch(); ensure network access is necessary.' },
    { regex: /XMLHttpRequest/i, message: 'Uses XMLHttpRequest; consider avoiding external calls.' },
    { regex: /chrome\./i, message: 'Touches chrome.* APIs; ensure permissions allow this.' },
  ];

  for (const { regex, message } of patterns) {
    if (regex.test(code)) {
      warnings.push(message);
    }
  }

  return warnings;
};

export const validateGeneratedScript = (payload: GeneratedScriptPayload): ScriptValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const jsCode = typeof payload.jsCode === 'string' ? payload.jsCode.trim() : '';
  const cssCode = typeof payload.cssCode === 'string' ? payload.cssCode.trim() : undefined;
  const urlMatchPattern = typeof payload.urlMatchPattern === 'string'
    ? payload.urlMatchPattern.trim()
    : undefined;

  if (!jsCode) {
    errors.push('Generated response did not include JavaScript to execute.');
  } else {
    if (jsCode.length > MAX_JS_LENGTH) {
      warnings.push(`JavaScript exceeds ${MAX_JS_LENGTH} characters; consider simplifying.`);
    }
    warnings.push(...containsDisallowedPatterns(jsCode));
  }

  if (cssCode && cssCode.length > MAX_CSS_LENGTH) {
    warnings.push(`CSS exceeds ${MAX_CSS_LENGTH} characters; consider simplifying.`);
  }

  return {
    ok: errors.length === 0,
    script: errors.length === 0 ? { jsCode, cssCode, urlMatchPattern } : undefined,
    errors,
    warnings,
  } satisfies ScriptValidationResult;
};
