import { useEffect, useRef, useState } from 'react';
import { formatClock, roleLabel } from '../lib/format.js';
import { actions } from '../lib/session.js';
import { SendIcon } from './icons.jsx';

export function MessageList({ messages, myRole }) {
  const listRef = useRef(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  return (
    <div className="messages" ref={listRef} aria-live="polite">
      {messages.length === 0 ? (
        <p className="messages-empty muted">No messages yet. Say hello!</p>
      ) : (
        <ol>
          {messages.map((message) => {
            const mine = message.from === myRole;
            return (
              <li key={message.id} className={`message ${mine ? 'mine' : 'theirs'}`}>
                <div className="message-meta">
                  <strong>{mine ? 'You' : message.name}</strong>
                  <span className={`role-tag role-${message.from}`}>{roleLabel(message.from)}</span>
                  <time dateTime={new Date(message.ts).toISOString()}>{formatClock(message.ts)}</time>
                </div>
                <p className="bubble">{message.text}</p>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export function ChatPanel({ messages, myRole, disabled }) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const result = await actions.sendMessage(text);
    setSending(false);
    if (result.ok) {
      setDraft('');
      setError(null);
    } else {
      setError(result.error);
    }
  };

  return (
    <section className="card chat" aria-label="Chat">
      <header className="chat-head">
        <h2>Chat</h2>
        <span className="muted">
          {messages.length} message{messages.length === 1 ? '' : 's'}
        </span>
      </header>
      <MessageList messages={messages} myRole={myRole} />
      <form className="chat-form" onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder={disabled ? 'Reconnecting...' : 'Type a message'}
          disabled={disabled}
          aria-label="Message"
        />
        <button type="submit" className="btn btn-primary btn-icon" disabled={disabled || sending || !draft.trim()} aria-label="Send">
          <SendIcon size={18} />
        </button>
      </form>
      {error && <p className="field-error">{error}</p>}
    </section>
  );
}
