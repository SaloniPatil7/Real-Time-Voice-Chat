import { createStore } from './createStore.js';
import { clearIdentity, loadIdentity, newClientId, saveIdentity } from './identity.js';
import { media } from './media.js';
import { socket } from './socket.js';

const REQUEST_TIMEOUT_MS = 8_000;

const blankSession = {
  connection: 'idle', // idle | connecting | connected | reconnecting
  connectionError: null,
  synced: false, // got session:state from the server at least once
  status: 'idle', // idle | waiting | in-call
  queuePosition: null,
  agentsOnline: 0,
  waiting: [], // agents only
  call: null,
  messages: [],
  peerReconnecting: null, // { deadline }
  ended: null, // data for the Call Ended screen
  notice: null, // { tone, text }
  replaced: false,
  clockOffset: 0, // server time - local time, keeps the call timer the same on both sides
};

export const session = createStore({ ...blankSession, identity: loadIdentity() });
const set = session.setState;

const splitCall = ({ messages, ...call }) => ({ call, messages });

function connect(identity) {
  socket.auth = identity;
  set({ connection: 'connecting' });
  socket.connect();
}

async function request(event, payload) {
  try {
    return await socket.timeout(REQUEST_TIMEOUT_MS).emitWithAck(event, payload);
  } catch {
    return { ok: false, error: 'The server did not respond. Check your connection and try again.' };
  }
}

const errorNotice = (text) => ({ notice: { tone: 'error', text } });

// Socket listeners are set up here instead of inside components. Right after a refresh the
// server sends session:state and webrtc:start immediately, before React has mounted anything.

socket.on('connect', () => set({ connection: 'connected', connectionError: null }));

socket.on('connect_error', (error) => {
  if (error.message === 'invalid_session') {
    clearIdentity();
    set({ ...blankSession, identity: null, ...errorNotice('Your session could not be restored. Please join again.') });
    return;
  }
  set({ connection: 'reconnecting', connectionError: "Can't reach the server. Retrying..." });
});

socket.on('disconnect', (reason) => {
  if (reason === 'io client disconnect' || session.getState().replaced) return;
  // socket.io won't retry by itself after a server side disconnect (e.g. server restarting)
  if (reason === 'io server disconnect') socket.connect();
  // keep the current screen, audio is p2p so it can keep going while the socket is down
  set({ connection: 'reconnecting', connectionError: 'Lost connection to the server. Reconnecting...' });
});

// sent on every connect/reconnect, this is what restores the call after a refresh
socket.on('session:state', (snapshot) => {
  const previous = session.getState();
  let { ended } = previous;
  if (snapshot.endedWhileAway) {
    ended = snapshot.endedWhileAway;
  } else if (previous.call && !snapshot.call) {
    ended = { reason: 'lost', by: 'you', peer: previous.call.peer, durationSec: null };
  }

  const { call, messages } = snapshot.call ? splitCall(snapshot.call) : { call: null, messages: previous.messages };
  if (call) media.setMuted(call.selfMuted);
  else if (previous.call || snapshot.user.status === 'idle') media.stop();

  set({
    synced: true,
    status: snapshot.user.status,
    queuePosition: snapshot.queuePosition,
    agentsOnline: snapshot.agentsOnline,
    waiting: snapshot.waiting,
    call,
    messages,
    peerReconnecting: call && !call.peer?.online ? { deadline: null } : null,
    ended,
    clockOffset: snapshot.serverNow - Date.now(),
  });
});

socket.on('queue:update', ({ waiting, agentsOnline }) => set({ waiting, agentsOnline }));
socket.on('queue:status', ({ position, agentsOnline }) => set({ queuePosition: position, agentsOnline }));

socket.on('call:started', (startedCall) => {
  set({ ...splitCall(startedCall), status: 'in-call', ended: null, notice: null, peerReconnecting: null });
});

socket.on('call:updated', (update) => {
  set((s) => (s.call?.id === update.id ? { call: { ...s.call, ...update } } : null));
});

socket.on('call:declined', ({ agentName }) => {
  media.stop();
  set({ status: 'idle', queuePosition: null, notice: { tone: 'info', text: `${agentName} declined the call. You can try again.` } });
});

socket.on('peer:reconnecting', ({ graceMs }) => {
  media.pause();
  set({ peerReconnecting: { deadline: Date.now() + graceMs } });
});
socket.on('peer:rejoined', () => set({ peerReconnecting: null }));

socket.on('webrtc:start', (payload) => media.start(payload));
socket.on('webrtc:signal', (payload) => media.handleSignal(payload));

socket.on('chat:message', (message) => set((s) => ({ messages: [...s.messages, message] })));

socket.on('call:ended', (summary) => {
  media.stop();
  set({ status: 'idle', call: null, peerReconnecting: null, ended: summary });
});

socket.on('session:replaced', () => {
  media.stop();
  set({ replaced: true, connection: 'idle', call: null, status: 'idle' });
});

// page was refreshed and we still have an identity
if (session.getState().identity) connect(session.getState().identity);

export const actions = {
  join(name, role) {
    const identity = { clientId: newClientId(), name: name.trim(), role };
    saveIdentity(identity);
    set({ ...blankSession, identity });
    connect(identity);
  },

  async requestCall() {
    set({ notice: null });
    // ask for the mic on the click, so permission problems show up before joining the queue
    if (!(await media.ensureMic())) return;
    const result = await request('queue:join');
    if (result.ok) set({ status: 'waiting' });
    else {
      media.stop();
      set(errorNotice(result.error));
    }
  },

  async cancelCall() {
    await request('queue:leave');
    // if an agent accepted at the same moment, call:started arrives before this reply,
    // so we're already in the call and should stay in it
    if (session.getState().call) return;
    media.stop();
    set({ status: 'idle', queuePosition: null });
  },

  async accept(customerId) {
    set({ notice: null });
    if (!(await media.ensureMic())) return;
    const result = await request('call:accept', { customerId });
    if (!result.ok) {
      media.stop();
      set(errorNotice(result.error));
    }
  },

  async decline(customerId) {
    const result = await request('call:decline', { customerId });
    if (!result.ok) set(errorNotice(result.error));
  },

  sendMessage: (text) => request('chat:send', { text }),

  toggleMute() {
    const muted = !media.store.getState().muted;
    media.setMuted(muted);
    socket.emit('call:mute', { muted });
  },

  endCall() {
    socket.emit('call:end'); // gets buffered and sent on reconnect if we're offline
    const { call, clockOffset, connection } = session.getState();
    if (connection === 'connected' || !call) return; // server will send call:ended
    media.stop();
    const durationSec = call.startedAt ? Math.round((Date.now() + clockOffset - call.startedAt) / 1000) : 0;
    set({ status: 'idle', call: null, peerReconnecting: null, ended: { reason: 'hangup', by: 'you', peer: call.peer, durationSec } });
  },

  dismissEnded: () => set({ ended: null, messages: [] }),
  dismissNotice: () => set({ notice: null }),

  // take the session back after another tab took it over
  resumeHere() {
    set({ replaced: false, synced: false });
    connect(session.getState().identity);
  },

  async signOut() {
    if (socket.connected) await request('session:logout');
    socket.disconnect();
    media.stop();
    clearIdentity();
    set({ ...blankSession, identity: null });
  },
};

// for the e2e test / debugging in devtools
window.voiceChat = { session, media };
