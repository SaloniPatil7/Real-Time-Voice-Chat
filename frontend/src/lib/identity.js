// sessionStorage instead of localStorage: it survives a refresh but each tab gets its own,
// so two tabs can be two different users
const KEY = 'voice-chat:identity';

export function loadIdentity() {
  try {
    const identity = JSON.parse(sessionStorage.getItem(KEY));
    return identity?.clientId && identity.name && identity.role ? identity : null;
  } catch {
    return null;
  }
}

export function saveIdentity(identity) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(identity));
  } catch {
    // storage blocked, refresh just won't restore the session
  }
}

export function clearIdentity() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function newClientId() {
  // randomUUID is only available on https/localhost
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
