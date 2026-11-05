import { useSession } from '../hooks/useSession.js';
import { roleLabel } from '../lib/format.js';
import { actions } from '../lib/session.js';
import { Avatar, Spinner } from './common.jsx';
import { LogOutIcon, PhoneIcon } from './icons.jsx';

export function Header() {
  const { identity, call } = useSession();

  const signOut = () => {
    if (call && !window.confirm('Signing out will end your current call. Continue?')) return;
    actions.signOut();
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">
          <PhoneIcon size={16} />
        </span>
        Voice Support
      </div>
      {identity && (
        <div className="who">
          <Avatar name={identity.name} size="sm" />
          <div className="who-text">
            <strong>{identity.name}</strong>
            <span>{roleLabel(identity.role)}</span>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signOut}>
            <LogOutIcon size={16} />
            <span className="hide-sm">Sign out</span>
          </button>
        </div>
      )}
    </header>
  );
}

export function ConnectionBanner() {
  const { identity, connection, connectionError, replaced, synced } = useSession();
  if (!identity || replaced || !synced || connection === 'connected') return null;
  return (
    <div className="banner" role="alert">
      <Spinner />
      {connectionError ?? 'Reconnecting...'}
    </div>
  );
}
