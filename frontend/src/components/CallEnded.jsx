import { useSession } from '../hooks/useSession.js';
import { formatDuration, roleLabel } from '../lib/format.js';
import { actions } from '../lib/session.js';
import { MessageList } from './ChatPanel.jsx';
import { PhoneOffIcon } from './icons.jsx';

function describeEnd({ reason, by, peer }) {
  const name = peer?.name ?? 'The other person';
  switch (reason) {
    case 'hangup':
      return by === 'you' ? 'You ended the call.' : `${name} ended the call.`;
    case 'left':
      return by === 'you' ? 'You signed out.' : `${name} left.`;
    case 'disconnected':
      return by === 'you'
        ? 'You were disconnected for too long, so the call was closed.'
        : `${name} disconnected and didn't come back.`;
    case 'lost':
      return 'The connection to the server was lost and the call could not be resumed.';
    default:
      return 'The call has ended.';
  }
}

export function CallEnded() {
  const { ended, messages, identity } = useSession();

  return (
    <section className="card narrow center ended">
      <div className="ended-icon">
        <PhoneOffIcon size={28} />
      </div>
      <h1>Call Ended</h1>
      <p>{describeEnd(ended)}</p>

      <dl className="summary">
        {ended.peer && (
          <div>
            <dt>With</dt>
            <dd>
              {ended.peer.name} <span className="muted">({roleLabel(ended.peer.role)})</span>
            </dd>
          </div>
        )}
        <div>
          <dt>Duration</dt>
          <dd>{ended.durationSec === null ? '-' : formatDuration(ended.durationSec)}</dd>
        </div>
        <div>
          <dt>Messages</dt>
          <dd>{messages.length}</dd>
        </div>
      </dl>

      {messages.length > 0 && (
        <details className="transcript">
          <summary>View chat transcript</summary>
          <MessageList messages={messages} myRole={identity.role} />
        </details>
      )}

      <button type="button" className="btn btn-primary" onClick={actions.dismissEnded}>
        {identity.role === 'agent' ? 'Back to queue' : 'Done'}
      </button>
    </section>
  );
}
