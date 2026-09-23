import { expect, test } from 'bun:test';
import { DEFAULT_FACE_SCAN_SCORING_CONFIG, faceScanRangeConfigSchema } from './face-scan-scoring';
const errors = (ranges: typeof DEFAULT_FACE_SCAN_SCORING_CONFIG.ranges) => {
  const parsed = faceScanRangeConfigSchema.safeParse({ ranges });
  return parsed.success ? [] : parsed.error.issues.map(issue => issue.message);
};
test('nested overlaps do not falsely report missing 100% coverage', () => {
  const ranges = structuredClone(DEFAULT_FACE_SCAN_SCORING_CONFIG.ranges);
  ranges[2]!.min = 60;
  const messages = errors(ranges);
  expect(messages).toHaveLength(2);
  expect(messages.some(message => message.includes('Rows 1 and 3 overlap between scores 60 and 70'))).toBe(true);
  expect(messages.some(message => message.includes('Rows 2 and 3 overlap between scores 70 and 80'))).toBe(true);
  expect(messages.some(message => message.includes('include 100'))).toBe(false);
});
test('coverage and shared endpoints are checked independently of row order', () => {
  const ranges = structuredClone(DEFAULT_FACE_SCAN_SCORING_CONFIG.ranges);
  expect(errors([...ranges].reverse())).toEqual([]);
  ranges[2]!.minInclusive = true;
  expect(errors(ranges)).toEqual(['Rows 2 and 3 both include score 80. In Edit score boundaries, include this value in only one row.']);
  ranges[2]!.minInclusive = false;
  ranges[1]!.maxInclusive = false;
  expect(errors(ranges)[0]).toContain('Score 80 is not included');
  ranges[2]!.max = 99;
  expect(errors(ranges).some(message => message.includes('include 100'))).toBe(true);
});

test('range labels are optional, bounded, and stored with the scoring rule', () => {
  const ranges = structuredClone(DEFAULT_FACE_SCAN_SCORING_CONFIG.ranges);
  expect(faceScanRangeConfigSchema.safeParse({ ranges }).success).toBe(true);
  expect(faceScanRangeConfigSchema.parse({ ranges: ranges.map((range, index) => ({ ...range, label: index === 0 ? 'Needs attention' : '' })) }).ranges[0]?.label).toBe('Needs attention');
  expect(faceScanRangeConfigSchema.safeParse({ ranges: ranges.map(range => ({ ...range, label: 'x'.repeat(81) })) }).success).toBe(false);
});
