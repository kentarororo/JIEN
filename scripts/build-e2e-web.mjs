import { buildWeb } from './build-web.mjs';

buildWeb(process.cwd(), {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: 'https://jien-e2e.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_jien_e2e',
});
