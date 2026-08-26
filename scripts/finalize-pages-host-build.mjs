import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST_REQUIREMENT_CODE = 'PAGES_HOST_UNSUPPORTED';
const VERCEL_TESTER_URL = 'https://jien-coral.vercel.app/';

export function finalizePagesHostBuild(projectRoot = process.cwd(), environment = process.env) {
  const distRoot = path.resolve(projectRoot, 'dist');
  const indexPath = path.join(distRoot, 'index.html');
  const bundleRoot = path.join(distRoot, '_expo', 'static', 'js', 'web');

  if (!existsSync(indexPath) || !existsSync(bundleRoot)) {
    throw new Error('Expo did not produce a complete GitHub Pages artifact.');
  }

  const index = readFileSync(indexPath, 'utf8');
  const configuredBasePath = (environment.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (configuredBasePath && !index.includes(`${configuredBasePath}/_expo/`)) {
    throw new Error(`The Pages artifact does not use its configured base path: ${configuredBasePath}`);
  }

  const htmlFiles = listHtmlFiles(distRoot);
  if (!htmlFiles.length) throw new Error('The GitHub Pages artifact contains no HTML routes.');
  const safeHostPage = createSafeHostPage();
  for (const htmlPath of htmlFiles) writeFileSync(htmlPath, safeHostPage);

  // Every exported route is now a static explanation with no application script,
  // so a Pages deep link cannot mount auth, SQLite, or any local-data consumer.
  writeFileSync(path.join(distRoot, '.nojekyll'), '');

  return { gatedHtmlFiles: htmlFiles, indexPath };
}

function listHtmlFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listHtmlFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(entryPath);
  }
  return files;
}

function createSafeHostPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Open JIEN on Vercel</title>
  <style>
    :root { color-scheme: light dark; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px; box-sizing: border-box; background: #F7F1E7; color: #2B211B; }
    main { width: min(100%, 520px); box-sizing: border-box; padding: 28px; border: 1px solid #E4D7C8; border-radius: 16px; background: #FFFBF5; }
    p { margin: 10px 0 0; line-height: 1.5; color: #6E6056; }
    .eyebrow, code { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: #71452F; }
    h1 { margin: 8px 0 0; font-size: clamp(28px, 7vw, 36px); line-height: 1.15; }
    a { display: inline-flex; min-height: 48px; margin-top: 22px; padding: 0 20px; align-items: center; justify-content: center; border-radius: 12px; background: #71452F; color: #FFF9F3; font-weight: 700; text-decoration: none; }
    code { display: block; margin-top: 18px; }
    @media (prefers-color-scheme: dark) {
      body { background: #17120F; color: #F7EFE4; }
      main { background: #211A16; border-color: #49392F; }
      p { color: #BDAEA1; }
      .eyebrow, code { color: #D7A47E; }
      a { background: #D7A47E; color: #2A1B14; }
    }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">JIEN WEB TESTER</div>
    <h1>Open JIEN on Vercel</h1>
    <p>This GitHub Pages build does not open JIEN's local database. Use the supported Vercel tester for workout, food, and wellness logging.</p>
    <p>No local data was read, moved, or removed.</p>
    <a href="${VERCEL_TESTER_URL}">Continue to JIEN</a>
    <code>Host code: ${HOST_REQUIREMENT_CODE}</code>
  </main>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = finalizePagesHostBuild();
  console.log(`Pages safety gate: ${result.gatedHtmlFiles.length} HTML routes replaced with a static host screen.`);
  console.log('GitHub Pages artifact is safe; use the Vercel deployment for functional testing.');
}
