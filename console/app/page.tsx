import { APP_CONFIG_DEFAULTS } from '@/app-config';
import { App } from '@/components/app/app';

const PROVIDERS: Record<string, string> = {
  bing: 'Bing',
  google: 'Google',
  duckduckgo: 'DuckDuckGo',
};

export default function Page() {
  const provider = (process.env.VISION_SEARCH_PROVIDER ?? 'bing').toLowerCase().trim();

  return <App appConfig={APP_CONFIG_DEFAULTS} searchProvider={PROVIDERS[provider] ?? 'Bing'} />;
}
