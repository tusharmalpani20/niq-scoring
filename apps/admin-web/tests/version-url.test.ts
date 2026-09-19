import { expect, test } from 'bun:test';
import { versionUrl, versionLookup } from '../src/rules/version-url';

test('readable version URLs preserve names without collisions', () => {
  for (const name of ['TEST-1', 'Test 1', 'A/B #1? 50%', '评估', '.', '..', 'by-name', '01M2T6J93S5GTN6PCJNFAQ0WJ2']) {
    const url = new URL(versionUrl(name), 'http://localhost');
    expect(versionLookup(url.pathname.split('/')[2]!, url.search).endpoint).toBe(name === "." || name === ".." ? `/admin/rules/by-name?name=${name}` : `/admin/rules/by-name/${encodeURIComponent(name)}`);
  }
  expect(versionUrl('TEST-1')).toBe('/versions/TEST-1');
});
test('existing ID URLs retain their ID lookup', () => {
  expect(versionLookup('01M2T6J93S5GTN6PCJNFAQ0WJ2', '').endpoint).toBe('/admin/rules/01M2T6J93S5GTN6PCJNFAQ0WJ2');
});
