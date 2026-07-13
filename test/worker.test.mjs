import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAttendanceUpdateRequest } from '../worker.js';

test('uses fallback values when Moodle omits attendance update fields', () => {
  const request = resolveAttendanceUpdateRequest({ statusid: 3, lasttakenby: undefined, statusset: 1 }, 42);
  assert.deepEqual(request, { statusId: 3, takenById: 42, statusSet: 1 });
});

test('reads status data from statuses array when present', () => {
  const request = resolveAttendanceUpdateRequest({ statuses: [{ id: 7 }], statusset: 0 }, 11);
  assert.deepEqual(request, { statusId: 7, takenById: 11, statusSet: 0 });
});
