'use client';

import { useMemo } from 'react';
import { LogLevel, TokenSource } from 'livekit-client';
import { useSession } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import { AgentSessionProvider } from '@/components/agents-ui/agent-session-provider';
import { LiveVision } from '@/components/vision/live-vision';
import { Grain } from '@/components/vision/primitives';
import { useDebugMode } from '@/hooks/useDebug';
import { getElectron, useIsElectron } from '@/lib/electron';
import { getSandboxTokenSource } from '@/lib/utils';

const IN_DEVELOPMENT = process.env.NODE_ENV !== 'production';

function DebugSetup() {
  useDebugMode({ enabled: IN_DEVELOPMENT, logLevel: LogLevel.warn });
  return null;
}

interface AppProps {
  appConfig: AppConfig;
  searchProvider: string;
}

export function App({ appConfig, searchProvider }: AppProps) {
  const tokenSource = useMemo(() => {
    if (typeof process.env.NEXT_PUBLIC_CONN_DETAILS_ENDPOINT === 'string') {
      return getSandboxTokenSource(appConfig);
    }
    // The VISION app mints the LiveKit token in its main process (no web server).
    return TokenSource.custom(async (options) => {
      const getConnectionDetails = getElectron()?.getConnectionDetails;
      if (!getConnectionDetails) throw new Error('Voice needs the VISION app.');
      return getConnectionDetails({ agentName: options.agentName });
    });
  }, [appConfig]);

  const session = useSession(
    tokenSource,
    appConfig.agentName ? { agentName: appConfig.agentName } : undefined
  );

  const isElectron = useIsElectron();

  return (
    <AgentSessionProvider session={session}>
      <DebugSetup />
      {/* In a browser tab the page itself is the backdrop; in Electron the window is transparent. */}
      {!isElectron && (
        <div aria-hidden className="pointer-events-none fixed inset-0">
          <Grain />
        </div>
      )}
      <LiveVision searchProvider={searchProvider} />
    </AgentSessionProvider>
  );
}
