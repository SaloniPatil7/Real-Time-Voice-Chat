import { useState } from 'react';
import { useMedia, useSession } from '../hooks/useSession.js';
import { actions } from '../lib/session.js';
import { Elapsed } from './Clocks.jsx';
import { Avatar, Notice, StatusBadge } from './common.jsx';
import { HeadphonesIcon, PhoneIcon } from './icons.jsx';

export function AgentDashboard() {
  const { waiting, notice, clockOffset } = useSession();
  const { micError } = useMedia();
  const [pendingId, setPendingId] = useState(null);

  const run = (action, customerId) => async () => {
    setPendingId(customerId);
    try {
      await action(customerId);
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section className="card dashboard">
      <header className="section-head">
        <div>
          <h1>Incoming calls</h1>
          <p className="muted">Customers waiting to talk, oldest first.</p>
        </div>
        <StatusBadge tone="ok" label="Available" />
      </header>

      {notice && (
        <Notice tone={notice.tone} onDismiss={actions.dismissNotice}>
          {notice.text}
        </Notice>
      )}
      {micError && <Notice tone="error">{micError}</Notice>}

      {waiting.length === 0 ? (
        <div className="empty">
          <HeadphonesIcon size={30} />
          <p>No one is waiting.</p>
          <p className="muted">New calls appear here instantly.</p>
        </div>
      ) : (
        <ul className="queue">
          {waiting.map((customer, index) => (
            <li key={customer.customerId} className={`queue-item${index === 0 ? ' next' : ''}`}>
              <Avatar name={customer.name} />
              <div className="queue-info">
                <strong>{customer.name}</strong>
                <span className="muted">
                  {index === 0 ? 'Next in line, waiting ' : 'Waiting '}<Elapsed since={customer.since} clockOffset={clockOffset} />
                </span>
              </div>
              <div className="queue-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={run(actions.decline, customer.customerId)}
                  disabled={pendingId !== null}
                >
                  Decline
                </button>
                <button
                  type="button"
                  className="btn btn-success"
                  onClick={run(actions.accept, customer.customerId)}
                  disabled={pendingId !== null}
                >
                  <PhoneIcon size={16} />
                  {pendingId === customer.customerId ? 'Connecting...' : 'Accept'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
