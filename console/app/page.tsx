import { headers } from 'next/headers';
import { App } from '@/components/app/app';
import { getAppConfig } from '@/lib/utils';

const PROVIDERS: Record<string, string> = {
  bing: 'Bing',
  google: 'Google',
  duckduckgo: 'DuckDuckGo',
};

export default async function Page() {
  const hdrs = await headers();
  const appConfig = await getAppConfig(hdrs);
  const provider = (process.env.VISION_SEARCH_PROVIDER ?? 'bing').toLowerCase().trim();

  return <App appConfig={appConfig} searchProvider={PROVIDERS[provider] ?? 'Bing'} />;
}
