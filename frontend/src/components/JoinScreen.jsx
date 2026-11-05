import { useState } from 'react';
import { useSession } from '../hooks/useSession.js';
import { actions } from '../lib/session.js';
import { Notice } from './common.jsx';
import { HeadphonesIcon, UserIcon } from './icons.jsx';

const ROLE_OPTIONS = [
  { value: 'customer', title: 'Customer', hint: 'Call support and talk to an agent', Icon: UserIcon },
  { value: 'agent', title: 'Agent', hint: 'Answer calls waiting in the queue', Icon: HeadphonesIcon },
];

export function JoinScreen() {
  const { notice } = useSession();
  const [name, setName] = useState('');
  const [role, setRole] = useState('customer');

  const submit = (event) => {
    event.preventDefault();
    if (name.trim()) actions.join(name, role);
  };

  return (
    <section className="card narrow">
      <h1>Welcome</h1>
      <p className="muted">
        Talk to support right from your browser. To try both sides, open this page in a second tab and pick the other
        role.
      </p>

      {notice && (
        <Notice tone={notice.tone} onDismiss={actions.dismissNotice}>
          {notice.text}
        </Notice>
      )}

      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>Your name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={40}
            placeholder="e.g. Priya Sharma"
            autoComplete="name"
            autoFocus
            required
          />
        </label>

        <fieldset className="role-picker">
          <legend>Join as</legend>
          {ROLE_OPTIONS.map(({ value, title, hint, Icon }) => (
            <label key={value} className={`role-option${role === value ? ' selected' : ''}`}>
              <input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)} />
              <Icon size={22} />
              <strong>{title}</strong>
              <span className="muted">{hint}</span>
            </label>
          ))}
        </fieldset>

        <button type="submit" className="btn btn-primary btn-block" disabled={!name.trim()}>
          Continue
        </button>
      </form>
    </section>
  );
}
