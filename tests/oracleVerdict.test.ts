import { expect, test } from 'vitest';
import { parseOracleVerdict } from '../src/oracleVerdict.js';

test('accepts an exact verdict as the final non-empty line', () => {
  expect(parseOracleVerdict('Some review text.\nVERDICT: clean\n')).toBe('clean');
  expect(parseOracleVerdict('Found a bug.\n\nVERDICT: blocking')).toBe('blocking');
});

test('rejects a verdict that is NOT the final line (echoed example then a blocker)', () => {
  const text = 'Use this format:\nVERDICT: clean\n\nReview result: I found a blocker. Do not merge yet.';
  expect(parseOracleVerdict(text)).toBeNull();
});

test('missing verdict fails closed (null)', () => {
  expect(parseOracleVerdict('The code looks fine to me, ship it.')).toBeNull();
});

test('ambiguous (two verdict lines) fails closed (null)', () => {
  expect(parseOracleVerdict('VERDICT: clean\nVERDICT: blocking')).toBeNull();
});

test('rejects lax formats — lowercase, no-space, leading-space (fail closed)', () => {
  expect(parseOracleVerdict('verdict: clean')).toBeNull();
  expect(parseOracleVerdict('VERDICT:clean')).toBeNull();
  expect(parseOracleVerdict('   VERDICT: clean')).toBeNull();
  expect(parseOracleVerdict('VERDICT: CLEAN')).toBeNull();
});

test('a verdict embedded mid-line is NOT accepted (must be its own final line)', () => {
  expect(parseOracleVerdict('I would say the VERDICT: clean overall')).toBeNull();
});

test('trailing whitespace/blank lines after the verdict are tolerated', () => {
  expect(parseOracleVerdict('VERDICT: clean   \n\n')).toBe('clean');
});
