import { actions } from '../lib/session.js';
import { Spinner } from './common.jsx';

export function ConnectingScreen({ error }) {
  return (
    <section className="card narrow center">
      <Spinner />
      <h1>Connecting...</h1>
      <p className={error ? 'error-text' : 'muted'}>{error ?? 'Restoring your session.'}</p>
      {error && (
        <button type="button" className="btn btn-secondary" onClick={actions.signOut}>
          Start over
        </button>
      )}
    </section>
  );
}

export function ReplacedScreen() {
  return (
    <section className="card narrow center">
      <h1>Opened in another tab</h1>
      <p className="muted">
        This session is now active in a different tab, so it was paused here. Only one tab can hold the call at a time.
      </p>
      <button type="button" className="btn btn-primary" onClick={actions.resumeHere}>
        Use this tab instead
      </button>
    </section>
  );
}
