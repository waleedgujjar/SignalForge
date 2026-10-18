import { randomInt } from 'node:crypto';

export interface SpintaxParseOptions {
  deterministic?: boolean;
  seed?: number;
}

export interface SpintaxParseResult {
  text: string;
  valid: boolean;
  error?: string;
}

export function parseSpintax(template: string, options: SpintaxParseOptions = {}): SpintaxParseResult {
  try {
    const text = parseSpintaxRecursive(template, options, 0);
    if (text.includes('{') || text.includes('}')) {
      return { text: '', valid: false, error: 'Unresolved spintax braces remain' };
    }
    return { text, valid: true };
  } catch (error) {
    return {
      text: '',
      valid: false,
      error: error instanceof Error ? error.message : 'Malformed spintax',
    };
  }
}

function parseSpintaxRecursive(
  input: string,
  options: SpintaxParseOptions,
  depth: number,
): string {
  if (depth > 50) {
    throw new Error('Spintax nesting too deep');
  }

  let result = '';
  let i = 0;

  while (i < input.length) {
    if (input[i] === '{') {
      const end = findMatchingBrace(input, i);
      if (end === -1) {
        throw new Error('Unmatched opening brace');
      }
      const inner = input.slice(i + 1, end);
      if (inner.includes('{')) {
        const resolvedInner = parseSpintaxRecursive(inner, options, depth + 1);
        const optionsList = splitTopLevel(resolvedInner, '|');
        result += pickOption(optionsList, options, depth + i);
      } else {
        const optionsList = splitTopLevel(inner, '|');
        if (optionsList.length === 0) {
          throw new Error('Empty spintax block');
        }
        result += pickOption(optionsList, options, depth + i);
      }
      i = end + 1;
    } else if (input[i] === '}') {
      throw new Error('Unmatched closing brace');
    } else {
      result += input[i];
      i += 1;
    }
  }

  return result;
}

function findMatchingBrace(input: string, start: number): number {
  let depth = 0;
  for (let i = start; i < input.length; i++) {
    if (input[i] === '{') depth += 1;
    if (input[i] === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function splitTopLevel(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = '';
  let braceDepth = 0;

  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (char === '{') braceDepth += 1;
    if (char === '}') braceDepth -= 1;

    if (char === delimiter && braceDepth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  parts.push(current);
  return parts.filter((p) => p.length > 0);
}

function pickOption(options: string[], parseOptions: SpintaxParseOptions, seedOffset: number): string {
  if (options.length === 1) return options[0]!;
  if (parseOptions.deterministic) {
    const seed = (parseOptions.seed ?? 0) + seedOffset;
    return options[seed % options.length]!;
  }
  return options[randomInt(options.length)]!;
}

export function validateSpintax(template: string): { valid: boolean; error?: string } {
  const result = parseSpintax(template, { deterministic: true, seed: 0 });
  return { valid: result.valid, error: result.error };
}
