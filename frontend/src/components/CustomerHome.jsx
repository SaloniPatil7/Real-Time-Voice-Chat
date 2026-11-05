import { useState } from 'react';
import { useMedia, useSession } from '../hooks/useSession.js';
import { actions } from '../lib/session.js';
import { Notice } from './common.jsx';
import { HeadphonesIcon, PhoneIcon } from './icons.jsx';

export function CustomerHome() {
  const { status, queuePosition, agentsOnline, notice } = useSession();
  const { micError } = useMedia();
  const [busy, setBusy] = useState(false);

  const run = (action) => async () => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  const notices = (
    <>
      {notice && (
        <Notice tone={notice.tone} onDismiss={actions.dismissNotice}>
          {notice.text}
        </Notice>
      )}
      {micError && <Notice tone="error">{micError}</Notice>}
    </>
  );

  if (status === 'waiting') {
    return (
      <section className="card narrow center">
        {notices}
        <div className="pulse">
          <HeadphonesIcon size={34} />
        </div>
        <h1>Waiting for an agent...</h1>
        <p className="muted">
          {queuePosition ? `You are #${queuePosition} in the queue.` : 'Joining the queue...'}{' '}
          {agentsOnline === 0 ? 'No agents are online yet. Please stay on the line.' : 'An agent will pick up shortly.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={run(actions.cancelCall)} disabled={busy}>
          Cancel call
        </button>
      </section>
    );
  }

  return (
    <section className="card narrow center">
      {notices}
      <h1>Need help?</h1>
      <p className="muted">Start a voice call and the next available agent will pick up.</p>
      <button
        type="button"
        className="call-button"
        onClick={run(actions.requestCall)}
        disabled={busy}
        aria-label="Call support"
      >
        <PhoneIcon size={34} />
      </button>
      <span className="call-button-label">{busy ? 'Starting...' : 'Call support'}</span>
      <p className="presence">
        <span className={`dot ${agentsOnline ? 'dot-ok' : 'dot-off'}`} />
        {agentsOnline ? `${agentsOnline} agent${agentsOnline > 1 ? 's' : ''} online` : 'No agents online right now'}
      </p>
    </section>
  );
}
