import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRuntimeDiagnostics,
  classifyRuntimeDiagnostic,
  parseRuntimeDiagnostics,
} from './runtime-diagnostics.ts';

test('runtime failures map to stable codes without retaining raw exception details', () => {
  assert.equal(classifyRuntimeDiagnostic(new Error('IndexedDB quota exceeded for private row 123')), 'LOCAL_STORAGE_ERROR');
  assert.equal(classifyRuntimeDiagnostic(new SyntaxError('Unexpected token in private response')), 'DATA_FORMAT_ERROR');
  assert.equal(classifyRuntimeDiagnostic(new Error('Component failed for private route')), 'UI_RENDER_ERROR');
});

test('runtime diagnostic history stores only counts, timestamps, and the latest code', () => {
  const first = buildRuntimeDiagnostics(null, 'UI_RENDER_ERROR', '2026-09-02T06:00:00Z');
  const second = buildRuntimeDiagnostics(first, 'LOCAL_STORAGE_ERROR', '2026-09-02T07:00:00Z');
  assert.deepEqual(second, {
    schemaVersion: 1,
    totalCount: 2,
    firstOccurredAt: '2026-09-02T06:00:00.000Z',
    lastOccurredAt: '2026-09-02T07:00:00.000Z',
    lastCode: 'LOCAL_STORAGE_ERROR',
  });
  assert.equal(JSON.stringify(second).includes('private'), false);
});

test('malformed runtime diagnostic history is ignored', () => {
  assert.equal(parseRuntimeDiagnostics(null), null);
  assert.equal(parseRuntimeDiagnostics('{broken'), null);
  assert.equal(parseRuntimeDiagnostics(JSON.stringify({
    schemaVersion: 1,
    totalCount: 0,
    firstOccurredAt: '2026-09-02T06:00:00Z',
    lastOccurredAt: '2026-09-02T07:00:00Z',
    lastCode: 'RAW_ERROR',
  })), null);
});
