import { describe, expect, test } from 'vitest';

import { formatMMSSms } from './format';

describe('formatMMSSms', () => {
  test('zero is fully zero-padded', () => {
    expect(formatMMSSms(0)).toBe('00:00.00');
  });

  test('sub-second values land in the hundredths field', () => {
    expect(formatMMSSms(10)).toBe('00:00.01');
    expect(formatMMSSms(990)).toBe('00:00.99');
    // Truncation, not rounding: 9ms < 1cs, so the field stays at .00.
    expect(formatMMSSms(9)).toBe('00:00.00');
  });

  test('whole-second boundary', () => {
    expect(formatMMSSms(999)).toBe('00:00.99');
    expect(formatMMSSms(1000)).toBe('00:01.00');
  });

  test('just under one minute', () => {
    expect(formatMMSSms(59_999)).toBe('00:59.99');
  });

  test('one minute boundary', () => {
    expect(formatMMSSms(60_000)).toBe('01:00.00');
  });

  test('truncates rather than rounding the fractional field', () => {
    // 1234ms → 01:01.23, not 01:01.24
    expect(formatMMSSms(61_234)).toBe('01:01.23');
    expect(formatMMSSms(61_239)).toBe('01:01.23');
  });

  test('beyond one hour: minutes are not capped at 99', () => {
    // 60min × 60_000 = 3_600_000
    expect(formatMMSSms(3_600_000)).toBe('60:00.00');
    // 61min 1.234s
    expect(formatMMSSms(60 * 60_000 + 61_234)).toBe('61:01.23');
    // 100 minutes — minutes grows past 2 digits, hundredths still padded.
    expect(formatMMSSms(100 * 60_000)).toBe('100:00.00');
  });

  test('non-finite and negative inputs collapse to 00:00.00', () => {
    expect(formatMMSSms(-1)).toBe('00:00.00');
    expect(formatMMSSms(-1_000_000)).toBe('00:00.00');
    expect(formatMMSSms(Number.NaN)).toBe('00:00.00');
    expect(formatMMSSms(Number.POSITIVE_INFINITY)).toBe('00:00.00');
    expect(formatMMSSms(Number.NEGATIVE_INFINITY)).toBe('00:00.00');
  });

  test('every output matches the documented shape', () => {
    const shape = /^\d{2,}:\d{2}\.\d{2}$/;
    for (const ms of [0, 1, 999, 1_000, 59_999, 60_000, 3_600_000, 7_200_500]) {
      expect(formatMMSSms(ms)).toMatch(shape);
    }
  });
});
