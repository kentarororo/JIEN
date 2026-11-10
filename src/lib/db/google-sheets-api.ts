export type GoogleSheetTabValues = {
  title: 'Workouts' | 'Nutrition';
  values: (string | number | boolean)[][];
};

export type GoogleSheetExportResult = {
  spreadsheetId: string;
  url: string;
  created: boolean;
};

type GoogleFetch = typeof fetch;
type SpreadsheetMetadata = {
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
};

const SHEET_NAME = 'JIEN export';
const SPREADSHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const REQUEST_TIMEOUT_MS = 20_000;

export class GoogleSheetsApiError extends Error {
  readonly code: 'AUTH' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_RESPONSE';

  constructor(code: 'AUTH' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_RESPONSE', message: string) {
    super(message);
    this.name = 'GoogleSheetsApiError';
    this.code = code;
  }
}

export async function replaceGoogleSheetExport(
  accessToken: string,
  tabs: GoogleSheetTabValues[],
  fetcher: GoogleFetch = fetch,
): Promise<GoogleSheetExportResult> {
  const existing = await findExportSheet(accessToken, fetcher);
  const created = !existing;
  let metadata = existing
    ? await getSpreadsheet(accessToken, existing.id, fetcher)
    : await createSpreadsheet(accessToken, fetcher);
  const spreadsheetId = metadata.spreadsheetId;
  if (!spreadsheetId) throw new GoogleSheetsApiError('INVALID_RESPONSE', 'Google Sheets did not return a spreadsheet ID. Try again.');

  metadata = await ensureTabs(accessToken, spreadsheetId, metadata, fetcher);
  const sheetIds = tabSheetIds(metadata);
  await googleRequest(fetcher, accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchClear`, {
    method: 'POST',
    body: JSON.stringify({ ranges: ["'Workouts'!A:H", "'Nutrition'!A:G"] }),
  });
  await googleRequest(fetcher, accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: tabs.map((tab) => ({ range: `'${tab.title}'!A1`, majorDimension: 'ROWS', values: tab.values })),
    }),
  });
  await formatSpreadsheet(accessToken, spreadsheetId, sheetIds, fetcher);

  return {
    spreadsheetId,
    url: metadata.spreadsheetUrl ?? existing?.webViewLink ?? `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}/edit`,
    created,
  };
}

async function findExportSheet(accessToken: string, fetcher: GoogleFetch): Promise<{ id: string; webViewLink?: string } | null> {
  const parameters = new URLSearchParams({
    q: `name = '${SHEET_NAME}' and mimeType = '${SPREADSHEET_MIME}' and trashed = false`,
    fields: 'files(id,webViewLink)',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
  });
  const result = await googleRequest<{ files?: { id?: string; webViewLink?: string }[] }>(
    fetcher,
    accessToken,
    `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
  );
  const file = result.files?.[0];
  return file?.id ? { id: file.id, webViewLink: file.webViewLink } : null;
}

async function createSpreadsheet(accessToken: string, fetcher: GoogleFetch): Promise<SpreadsheetMetadata> {
  return googleRequest(fetcher, accessToken, 'https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SHEET_NAME },
      sheets: [
        { properties: { sheetId: 0, title: 'Workouts', gridProperties: { frozenRowCount: 1 } } },
        { properties: { sheetId: 1, title: 'Nutrition', gridProperties: { frozenRowCount: 1 } } },
      ],
    }),
  });
}

async function getSpreadsheet(accessToken: string, spreadsheetId: string, fetcher: GoogleFetch): Promise<SpreadsheetMetadata> {
  const fields = encodeURIComponent('spreadsheetId,spreadsheetUrl,sheets(properties(sheetId,title))');
  return googleRequest(fetcher, accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${fields}`);
}

async function ensureTabs(
  accessToken: string,
  spreadsheetId: string,
  metadata: SpreadsheetMetadata,
  fetcher: GoogleFetch,
): Promise<SpreadsheetMetadata> {
  const titles = new Set(metadata.sheets?.map((sheet) => sheet.properties?.title).filter(Boolean));
  const missing = (['Workouts', 'Nutrition'] as const).filter((title) => !titles.has(title));
  if (!missing.length) return metadata;
  await googleRequest(fetcher, accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) }),
  });
  return getSpreadsheet(accessToken, spreadsheetId, fetcher);
}

function tabSheetIds(metadata: SpreadsheetMetadata): Record<'Workouts' | 'Nutrition', number> {
  const entries = metadata.sheets?.flatMap((sheet) => {
    const { sheetId, title } = sheet.properties ?? {};
    return typeof sheetId === 'number' && (title === 'Workouts' || title === 'Nutrition') ? [[title, sheetId] as const] : [];
  }) ?? [];
  const ids = Object.fromEntries(entries) as Partial<Record<'Workouts' | 'Nutrition', number>>;
  if (ids.Workouts == null || ids.Nutrition == null) {
    throw new GoogleSheetsApiError('INVALID_RESPONSE', 'Google Sheets could not prepare the Workouts and Nutrition tabs. Try again.');
  }
  return ids as Record<'Workouts' | 'Nutrition', number>;
}

async function formatSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  sheetIds: Record<'Workouts' | 'Nutrition', number>,
  fetcher: GoogleFetch,
): Promise<void> {
  const requests = (Object.entries(sheetIds) as ['Workouts' | 'Nutrition', number][]).flatMap(([title, sheetId]) => {
    const columnCount = title === 'Workouts' ? 8 : 7;
    const numberFormats = title === 'Workouts'
      ? [
          [3, 4, '0'],
          [4, 5, '0.00'],
          [5, 6, '0'],
          [6, 7, '0.0'],
          [7, 8, '0.00'],
        ] as const
      : [
          [2, 3, '0'],
          [3, 7, '0.00'],
        ] as const;
    return [
      { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: 'gridProperties.frozenRowCount' } },
      { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: columnCount }, cell: { userEnteredFormat: { backgroundColor: { red: 0.91, green: 0.83, blue: 0.76 }, textFormat: { bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } },
      { repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } } }, fields: 'userEnteredFormat.numberFormat' } },
      ...numberFormats.map(([startColumnIndex, endColumnIndex, pattern]) => ({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex, endColumnIndex }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern } } }, fields: 'userEnteredFormat.numberFormat' } })),
      { autoResizeDimensions: { dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: columnCount } } },
    ];
  });
  await googleRequest(fetcher, accessToken, `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}

async function googleRequest<T = Record<string, unknown>>(
  fetcher: GoogleFetch,
  accessToken: string,
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      ...init,
      signal: controller.signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new GoogleSheetsApiError('AUTH', 'Google Drive access expired. Export again to reconnect.');
      if (response.status === 429) throw new GoogleSheetsApiError('RATE_LIMITED', 'Google Sheets is busy. Wait a moment, then retry the export.');
      throw new GoogleSheetsApiError('UNAVAILABLE', 'Google Sheets could not update the export. Try again.');
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof GoogleSheetsApiError) throw error;
    throw new GoogleSheetsApiError('UNAVAILABLE', 'Google Sheets could not update the export. Check the connection and try again.');
  } finally {
    clearTimeout(timeout);
  }
}
