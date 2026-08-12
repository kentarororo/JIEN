import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

const pagesBaseUrl = process.env.EXPO_PUBLIC_BASE_URL;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />
        <meta name="theme-color" content="#71452F" />
        <title>JIEN</title>
        <ScrollViewStyleReset />
        {pagesBaseUrl ? <script src={`${pagesBaseUrl}/coi-serviceworker.js`} /> : null}
      </head>
      <body>{children}</body>
    </html>
  );
}
