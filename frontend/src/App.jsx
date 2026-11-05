import { useEffect } from 'react';
import { AgentDashboard } from './components/AgentDashboard.jsx';
import { CallEnded } from './components/CallEnded.jsx';
import { CallScreen } from './components/CallScreen.jsx';
import { CustomerHome } from './components/CustomerHome.jsx';
import { ConnectionBanner, Header } from './components/Header.jsx';
import { JoinScreen } from './components/JoinScreen.jsx';
import { ConnectingScreen, ReplacedScreen } from './components/StatusScreens.jsx';
import { useSession } from './hooks/useSession.js';

function currentScreen(s) {
  if (!s.identity) return <JoinScreen />;
  if (s.replaced) return <ReplacedScreen />;
  if (!s.synced) return <ConnectingScreen error={s.connectionError} />;
  if (s.ended) return <CallEnded />;
  if (s.call) return <CallScreen />;
  return s.identity.role === 'agent' ? <AgentDashboard /> : <CustomerHome />;
}

function useDocumentTitle({ call, identity, waiting }) {
  const peerName = call?.peer?.name;
  const incoming = identity?.role === 'agent' ? waiting.length : 0;

  useEffect(() => {
    if (peerName) document.title = `On call with ${peerName} - Voice Support`;
    else if (incoming) document.title = `(${incoming}) Incoming call - Voice Support`;
    else document.title = 'Voice Support';
  }, [peerName, incoming]);
}

export default function App() {
  const session = useSession();
  useDocumentTitle(session);

  return (
    <div className="app">
      <Header />
      <ConnectionBanner />
      <main className="main">{currentScreen(session)}</main>
    </div>
  );
}
