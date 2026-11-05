import assert from 'node:assert/strict';
import test from 'node:test';

import { GoogleSheetsApiError, replaceGoogleSheetExport, type GoogleSheetTabValues } from './google-sheets-api.ts';

type Call = { url: string; method: string; body: any; auth: string | null };

const tabs: GoogleSheetTabValues[] = [
  { title: 'Workouts', values: [['Date'], [46000]] },
  { title: 'Nutrition', values: [['Date'], [46000]] },
];

function fakeGoogle(options: { existing?: boolean; sheets?: { sheetId: number; title: string }[]; failOn?: RegExp; status?: number } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const headers = init.headers as Record<string, string>;
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null, auth: headers?.Authorization ?? null });
    if (options.failOn?.test(`${method} ${url}`)) return new Response('{}', { status: options.status ?? 500 });
    const sheets = (options.sheets ?? [{ sheetId: 0, title: 'Workouts' }, { sheetId: 1, title: 'Nutrition' }]).map((properties) => ({ properties }));
    let body: unknown = {};
    if (url.startsWith('https://www.googleapis.com/drive/v3/files')) body = { files: options.existing ? [{ id: 'sheet-1', webViewLink: 'https://docs.google.com/spreadsheets/d/sheet-1/edit' }] : [] };
    else if (method === 'POST' && url === 'https://sheets.googleapis.com/v4/spreadsheets') body = { spreadsheetId: 'new-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/new-1/edit', sheets };
    else if (method === 'GET' && url.includes('/v4/spreadsheets/')) body = { spreadsheetId: 'sheet-1', spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit', sheets: options.sheets && calls.filter((c) => c.method === 'GET' && c.url.includes('/v4/')).length > 1 ? [{ properties: { sheetId: 0, title: 'Workouts' } }, { properties: { sheetId: 9, title: 'Nutrition' } }] : sheets };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { calls, fetcher };
}

test('first export creates one "JIEN export" spreadsheet with both tabs, writes values and returns its link', async () => {
  const google = fakeGoogle();
  const result = await replaceGoogleSheetExport('token-abc', tabs, google.fetcher);
  assert.deepEqual(result, { spreadsheetId: 'new-1', url: 'https://docs.google.com/spreadsheets/d/new-1/edit', created: true });
  const search = new URL(google.calls[0]!.url);
  assert.match(search.searchParams.get('q')!, /name = 'JIEN export' and mimeType = 'application\/vnd.google-apps.spreadsheet' and trashed = false/);
  const create = google.calls.find((c) => c.method === 'POST' && c.url === 'https://sheets.googleapis.com/v4/spreadsheets')!;
  assert.equal(create.body.properties.title, 'JIEN export');
  assert.deepEqual(create.body.sheets.map((s: any) => [s.properties.title, s.properties.gridProperties.frozenRowCount]), [['Workouts', 1], ['Nutrition', 1]]);
  assert.ok(google.calls.every((c) => c.auth === 'Bearer token-abc'));
});

test('re-export updates the existing sheet: clears both tabs before writing, so rows never duplicate', async () => {
  const google = fakeGoogle({ existing: true });
  const result = await replaceGoogleSheetExport('t', tabs, google.fetcher);
  assert.equal(result.created, false);
  assert.equal(result.spreadsheetId, 'sheet-1');
  assert.ok(!google.calls.some((c) => c.method === 'POST' && c.url === 'https://sheets.googleapis.com/v4/spreadsheets'), 'no second spreadsheet is created');
  const clearIndex = google.calls.findIndex((c) => c.url.endsWith('/values:batchClear'));
  const writeIndex = google.calls.findIndex((c) => c.url.endsWith('/values:batchUpdate'));
  assert.ok(clearIndex >= 0 && writeIndex > clearIndex);
  assert.deepEqual(google.calls[clearIndex]!.body.ranges, ["'Workouts'!A:H", "'Nutrition'!A:G"]);
  const write = google.calls[writeIndex]!.body;
  assert.equal(write.valueInputOption, 'RAW');
  assert.deepEqual(write.data.map((d: any) => d.range), ["'Workouts'!A1", "'Nutrition'!A1"]);
});

test('formatting freezes the header row and applies a date format to column A on both tabs', async () => {
  const google = fakeGoogle({ existing: true });
  await replaceGoogleSheetExport('t', tabs, google.fetcher);
  const format = google.calls.filter((c) => c.url.endsWith(':batchUpdate')).at(-1)!.body.requests as any[];
  for (const sheetId of [0, 1]) {
    assert.ok(format.some((r) => r.updateSheetProperties?.properties.sheetId === sheetId && r.updateSheetProperties.properties.gridProperties.frozenRowCount === 1));
    assert.ok(format.some((r) => r.repeatCell?.range.sheetId === sheetId && r.repeatCell.range.startColumnIndex === 0 && r.repeatCell.cell.userEnteredFormat.numberFormat?.type === 'DATE'));
  }
});

test('a tab the user deleted is re-added before writing', async () => {
  const google = fakeGoogle({ existing: true, sheets: [{ sheetId: 0, title: 'Workouts' }] });
  await replaceGoogleSheetExport('t', tabs, google.fetcher);
  const add = google.calls.find((c) => c.body?.requests?.some((r: any) => r.addSheet));
  assert.deepEqual(add!.body.requests.map((r: any) => r.addSheet.properties.title), ['Nutrition']);
});

test('only Drive and Sheets REST endpoints are called (no broad drive scope endpoints, no JIEN backend)', async () => {
  const google = fakeGoogle();
  await replaceGoogleSheetExport('t', tabs, google.fetcher);
  assert.ok(google.calls.every((c) => /^https:\/\/(sheets\.googleapis\.com\/v4\/spreadsheets|www\.googleapis\.com\/drive\/v3\/files\?)/.test(c.url)), google.calls.map((c) => c.url).join('\n'));
});

for (const [status, code] of [[401, 'AUTH'], [403, 'AUTH'], [429, 'RATE_LIMITED'], [500, 'UNAVAILABLE']] as const) {
  test(`a ${status} from Google becomes a ${code} error with a retry message and stops before writing`, async () => {
    const google = fakeGoogle({ existing: true, failOn: /values:batchClear/, status });
    await assert.rejects(replaceGoogleSheetExport('t', tabs, google.fetcher), (error: unknown) => error instanceof GoogleSheetsApiError && error.code === code && /again|retry|Wait/i.test(error.message));
    assert.ok(!google.calls.some((c) => c.url.endsWith('/values:batchUpdate')));
  });
}

test('a network failure becomes UNAVAILABLE and never leaks the token in the message', async () => {
  const fetcher = (async () => { throw new TypeError('Failed to fetch secret-token'); }) as typeof fetch;
  await assert.rejects(replaceGoogleSheetExport('secret-token', tabs, fetcher), (error: unknown) => error instanceof GoogleSheetsApiError && error.code === 'UNAVAILABLE' && !error.message.includes('secret-token'));
});
