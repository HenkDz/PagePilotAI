import { describe, expect, it } from 'vitest';

import { validateGeneratedScript } from '../../src/ai/scriptValidator.js';

describe('scriptValidator', () => {
  it('accepts minimal payloads with jsCode', () => {
    const result = validateGeneratedScript({ jsCode: 'console.log("ok");' });
    expect(result.ok).toBe(true);
    expect(result.script?.jsCode).toBe('console.log("ok");');
    expect(result.errors).toHaveLength(0);
  });

  it('accepts CSS-only payloads', () => {
    const result = validateGeneratedScript({ jsCode: '   ', cssCode: '.foo { color: red; }' });
    expect(result.ok).toBe(true);
    expect(result.script?.jsCode).toBe('');
    expect(result.script?.cssCode).toBe('.foo { color: red; }');
    expect(result.errors).toHaveLength(0);
  });

  it('rejects payloads without javascript or css', () => {
    const result = validateGeneratedScript({ jsCode: '   ', cssCode: '   ' });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toMatch(/did not include JavaScript or CSS/i);
  });

  it('adds warnings for suspicious patterns and large payloads', () => {
    const result = validateGeneratedScript({
      jsCode: 'fetch("https://example.test");\n' + 'x'.repeat(8001),
      cssCode: 'y'.repeat(4001),
    });

    expect(result.ok).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('fetch'))).toBe(true);
    expect(result.warnings.some((warning) => warning.includes('exceeds'))).toBe(true);
  });
});
