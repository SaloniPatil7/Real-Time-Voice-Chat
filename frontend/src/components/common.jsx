import { initials, nameHue } from '../lib/format.js';
import { AlertIcon, CloseIcon, InfoIcon } from './icons.jsx';

export function Avatar({ name, size = 'md' }) {
  return (
    <span className={`avatar avatar-${size}`} style={{ '--hue': nameHue(name) }} aria-hidden="true">
      {initials(name)}
    </span>
  );
}

export function Notice({ tone = 'info', children, action, onDismiss }) {
  const Icon = tone === 'info' ? InfoIcon : AlertIcon;
  return (
    <div className={`notice notice-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon size={18} className="notice-icon" />
      <div className="notice-body">{children}</div>
      {action}
      {onDismiss && (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss">
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}

export function StatusBadge({ tone, label }) {
  return (
    <span className={`badge badge-${tone}`} role="status">
      <span className="dot" />
      {label}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
