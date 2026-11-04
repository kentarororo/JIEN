import type { SQLiteDatabase } from 'expo-sqlite';
import * as Network from 'expo-network';
import { Platform } from 'react-native';

import { requestGoogleDriveAccessToken } from '@/lib/auth/google-drive';
import {
  getGoogleSheetsExportData,
  replaceGoogleSheetExport,
  type GoogleSheetExportResult,
} from '@/lib/db';

import { buildGoogleSheetsTabs } from './google-sheets-mapping';

export class GoogleSheetsExportError extends Error {
  readonly code: 'OFFLINE' | 'UNAVAILABLE';

  constructor(code: 'OFFLINE' | 'UNAVAILABLE', message: string) {
    super(message);
    this.name = 'GoogleSheetsExportError';
    this.code = code;
  }
}

export async function exportToGoogleSheets(db: SQLiteDatabase): Promise<GoogleSheetExportResult> {
  if (Platform.OS !== 'web') {
    throw new GoogleSheetsExportError('UNAVAILABLE', 'Google Sheets export is available in the web app.');
  }
  const network = await Network.getNetworkStateAsync();
  if (!network.isConnected || network.isInternetReachable === false) {
    throw new GoogleSheetsExportError('OFFLINE', 'Export needs a connection.');
  }
  const accessToken = await requestGoogleDriveAccessToken();
  const data = await getGoogleSheetsExportData(db);
  return replaceGoogleSheetExport(accessToken, buildGoogleSheetsTabs(data));
}
