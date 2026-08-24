import {
  existsSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST_REQUIREMENT_CODE = 'CROSS_ORIGIN_ISOLATION_REQUIRED';

export function finalizePagesHostBuild(projectRoot = process.cwd()) {
  const distRoot = path.resolve(projectRoot, 'dist');
  const indexPath = path.join(distRoot, 'index.html');
  const bundleRoot = path.join(distRoot, '_expo', 'static', 'js', 'web');

  if (!existsSync(indexPath) || !existsSync(bundleRoot)) {
    throw new Error('Expo did not produce a complete GitHub Pages artifact.');
  }

  const bundles = readdirSync(bundleRoot)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(bundleRoot, name));
  const hostGateBundle = bundles.find((bundlePath) =>
    readFileSync(bundlePath, 'utf8').includes(HOST_REQUIREMENT_CODE),
  );

  if (!hostGateBundle) {
    throw new Error("The GitHub Pages artifact is missing JIEN's safe SQLite host gate.");
  }

  const index = readFileSync(indexPath, 'utf8');
  const configuredBasePath = (process.env.EXPO_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  if (configuredBasePath && !index.includes(`${configuredBasePath}/_expo/`)) {
    throw new Error(`The Pages artifact does not use its configured base path: ${configuredBasePath}`);
  }

  // Functional web testing remains limited to the supported Vercel host contract.
  // The Pages gate prevents local persistence from mounting there and explains
  // where testers should go.
  writeFileSync(path.join(distRoot, '.nojekyll'), '');

  return { hostGateBundle, indexPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = finalizePagesHostBuild();
  console.log(`Pages safety gate: ${path.relative(process.cwd(), result.hostGateBundle)}`);
  console.log('GitHub Pages artifact is safe; use the Vercel deployment for functional testing.');
}
