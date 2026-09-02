export type RuntimeDiagnosticCode =
  | 'LOCAL_STORAGE_ERROR'
  | 'DATA_FORMAT_ERROR'
  | 'UI_RENDER_ERROR';

export function classifyRuntimeDiagnostic(cause: unknown): RuntimeDiagnosticCode {
  const error = cause && typeof cause === 'object'
    ? cause as { name?: unknown; message?: unknown }
    : {};
  const text = [error.name, error.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLocaleLowerCase();
  if (/sqlite|indexeddb|database|storage|quota|wasm|durab/.test(text)) return 'LOCAL_STORAGE_ERROR';
  if (/json|parse|malformed|invalid data|unexpected token/.test(text)) return 'DATA_FORMAT_ERROR';
  return 'UI_RENDER_ERROR';
}

export function isRuntimeDiagnosticCode(value: unknown): value is RuntimeDiagnosticCode {
  return value === 'LOCAL_STORAGE_ERROR' || value === 'DATA_FORMAT_ERROR' || value === 'UI_RENDER_ERROR';
}
