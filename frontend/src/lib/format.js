const pad = (n) => String(n).padStart(2, '0');

export function formatDuration(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  return hours ? `${hours}:${pad(minutes)}:${pad(s % 60)}` : `${pad(minutes)}:${pad(s % 60)}`;
}

export const formatClock = (timestamp) =>
  new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export const roleLabel = (role) => (role === 'agent' ? 'Agent' : 'Customer');

export function initials(name = '') {
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase());
  return letters.join('') || '?';
}

// same name -> same avatar colour on both screens
export function nameHue(name = '') {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % 360;
}
