import { ROLES } from './store.js';

const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;
const fail = (error) => ({ ok: false, error });

function parseAuth(auth, maxNameLength) {
  const { clientId, name, role } = auth ?? {};
  if (typeof clientId !== 'string' || !CLIENT_ID_PATTERN.test(clientId)) return null;
  if (!ROLES.includes(role)) return null;
  const cleanName = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, maxNameLength) : '';
  if (!cleanName) return null;
  return { clientId, name: cleanName, role };
}

export function registerHandlers(io, store, settings) {
  const { graceMs, offlineTtlMs, maxNameLength, maxMessageLength } = settings;
  const log = settings.log ? (...args) => console.log('[voice-chat]', ...args) : () => {};

  const emitTo = (user, event, payload) => {
    if (user?.online && user.socketId) io.to(user.socketId).emit(event, payload);
  };

  function broadcastQueue() {
    const agentsOnline = store.onlineUsers('agent').length;
    io.to('agents').emit('queue:update', { waiting: store.waitingList(), agentsOnline });
    for (const customer of store.onlineUsers('customer')) {
      emitTo(customer, 'queue:status', { position: store.queuePosition(customer), agentsOnline });
    }
  }

  function broadcastCallUpdate(call) {
    for (const user of store.participants(call)) emitTo(user, 'call:updated', store.callView(call, user));
  }

  // Both sides throw away their old peer connection and make a new one.
  // Agent always sends the offer so they never both offer at once, and the id
  // lets clients ignore signals from an older attempt.
  function startNegotiation(call) {
    call.negotiationId += 1;
    const negotiationId = call.negotiationId;
    emitTo(store.users.get(call.customerId), 'webrtc:start', { negotiationId, initiator: false });
    emitTo(store.users.get(call.agentId), 'webrtc:start', { negotiationId, initiator: true });
  }

  function endCall(call, reason, endedBy) {
    const participants = store.participants(call);
    const durationSec = store.finishCall(call);
    for (const user of participants) {
      const peer = participants.find((p) => p !== user);
      const payload = {
        reason, // hangup | disconnected | left
        by: endedBy === user ? 'you' : 'peer',
        peer: peer ? { name: peer.name, role: peer.role } : null,
        durationSec,
      };
      if (user.online) emitTo(user, 'call:ended', payload);
      else user.missedEnd = payload;
    }
    log(`call ${call.id.slice(0, 8)} ended (${reason} by ${endedBy.name}, ${durationSec}s)`);
    broadcastQueue();
  }

  function scheduleGrace(user) {
    clearTimeout(user.timer);
    user.timer = setTimeout(() => {
      if (user.online) return;
      const call = store.callOf(user);
      if (call) endCall(call, 'disconnected', user);
      if (user.status === 'waiting') {
        store.dequeue(user);
        broadcastQueue();
      }
      user.timer = setTimeout(() => store.removeUser(user), offlineTtlMs);
      user.timer.unref();
    }, graceMs);
    user.timer.unref();
  }

  io.use((socket, next) => {
    const auth = parseAuth(socket.handshake.auth, maxNameLength);
    if (!auth) return next(new Error('invalid_session'));
    socket.data.auth = auth;
    next();
  });

  io.on('connection', (socket) => {
    const user = store.getOrCreateUser(socket.data.auth);
    const { clientId } = user;
    const replacedSocket = user.online ? io.sockets.sockets.get(user.socketId) : null;

    clearTimeout(user.timer);
    user.timer = null;
    user.socketId = socket.id;
    user.online = true;

    // same session opened in another tab (duplicating a tab copies sessionStorage), newest one wins
    if (replacedSocket) {
      replacedSocket.emit('session:replaced');
      replacedSocket.disconnect();
    }

    socket.join(user.role === 'agent' ? 'agents' : 'customers');
    socket.emit('session:state', { ...store.sessionView(user), endedWhileAway: user.missedEnd });
    user.missedEnd = null;

    const call = store.callOf(user);
    if (call) {
      const peer = store.peerOf(call, user);
      log(`${user.name} rejoined call ${call.id.slice(0, 8)}`);
      emitTo(peer, 'peer:rejoined');
      broadcastCallUpdate(call);
      if (peer?.online) startNegotiation(call);
    }
    broadcastQueue();

    // null if another tab took over or the user signed out
    const currentUser = () => {
      const u = store.users.get(clientId);
      return u && u.socketId === socket.id ? u : null;
    };

    const on = (event, handler) => {
      socket.on(event, (payload, ack) => {
        if (typeof payload === 'function') [payload, ack] = [undefined, payload];
        const reply = typeof ack === 'function' ? ack : () => {};
        const me = currentUser();
        if (!me) return reply(fail('This session is no longer active.'));
        try {
          reply(handler(me, payload ?? {}) ?? { ok: true });
        } catch (err) {
          console.error(`[voice-chat] ${event} failed`, err);
          reply(fail('Something went wrong on the server.'));
        }
      });
    };

    on('queue:join', (me) => {
      if (me.role !== 'customer') return fail('Only customers can request a call.');
      if (me.status === 'in-call') return fail('You are already in a call.');
      store.enqueue(me);
      log(`${me.name} is waiting for an agent`);
      broadcastQueue();
    });

    on('queue:leave', (me) => {
      // usually means an agent accepted at the same moment, client keeps the call in that case
      if (me.status !== 'waiting') return fail('You are not in the queue.');
      store.dequeue(me);
      broadcastQueue();
    });

    on('call:accept', (me, { customerId }) => {
      if (me.role !== 'agent') return fail('Only agents can accept calls.');
      if (me.status !== 'idle') return fail('Finish your current call first.');
      const customer = store.findWaitingCustomer(customerId);
      if (!customer) return fail('That customer is no longer waiting.');

      store.dequeue(customer);
      const newCall = store.createCall(customer, me);
      log(`call ${newCall.id.slice(0, 8)} started: ${customer.name} / ${me.name}`);
      for (const u of [customer, me]) emitTo(u, 'call:started', store.callView(newCall, u, { withMessages: true }));
      startNegotiation(newCall);
      broadcastQueue();
    });

    on('call:decline', (me, { customerId }) => {
      if (me.role !== 'agent') return fail('Only agents can decline calls.');
      const customer = store.findWaitingCustomer(customerId);
      if (!customer) return fail('That customer is no longer waiting.');
      store.dequeue(customer);
      emitTo(customer, 'call:declined', { agentName: me.name });
      broadcastQueue();
    });

    on('webrtc:signal', (me, { negotiationId, description, candidate }) => {
      const activeCall = store.callOf(me);
      if (!activeCall) return fail('You are not in a call.');
      if (negotiationId !== activeCall.negotiationId) return; // old attempt
      if (description && !['offer', 'answer'].includes(description.type)) return fail('Invalid session description.');
      emitTo(store.peerOf(activeCall, me), 'webrtc:signal', { negotiationId, description, candidate });
    });

    on('webrtc:restart', (me) => {
      const activeCall = store.callOf(me);
      if (!activeCall) return fail('You are not in a call.');
      if (store.peerOf(activeCall, me)?.online) startNegotiation(activeCall);
    });

    on('call:media-connected', (me) => {
      const activeCall = store.callOf(me);
      if (!activeCall || activeCall.startedAt) return;
      activeCall.startedAt = Date.now();
      activeCall.status = 'active';
      broadcastCallUpdate(activeCall);
    });

    on('call:mute', (me, { muted }) => {
      const activeCall = store.callOf(me);
      if (!activeCall) return fail('You are not in a call.');
      activeCall.muted[me.clientId] = Boolean(muted);
      broadcastCallUpdate(activeCall);
    });

    on('chat:send', (me, { text }) => {
      const activeCall = store.callOf(me);
      if (!activeCall) return fail('You are not in a call.');
      const clean = typeof text === 'string' ? text.trim() : '';
      if (!clean) return fail('Message is empty.');
      if (clean.length > maxMessageLength) return fail(`Messages are limited to ${maxMessageLength} characters.`);
      const message = store.addMessage(activeCall, me, clean);
      for (const u of store.participants(activeCall)) emitTo(u, 'chat:message', message);
    });

    on('call:end', (me) => {
      const activeCall = store.callOf(me);
      if (!activeCall) return fail('You are not in a call.');
      endCall(activeCall, 'hangup', me);
    });

    // explicit sign out, so no grace period
    on('session:logout', (me) => {
      const activeCall = store.callOf(me);
      if (activeCall) endCall(activeCall, 'left', me);
      store.dequeue(me);
      store.removeUser(me);
      broadcastQueue();
    });

    socket.on('disconnect', () => {
      const me = currentUser();
      if (!me) return;
      me.online = false;
      me.socketId = null;
      const activeCall = store.callOf(me);
      if (activeCall) {
        log(`${me.name} dropped from call ${activeCall.id.slice(0, 8)}, waiting ${graceMs / 1000}s`);
        emitTo(store.peerOf(activeCall, me), 'peer:reconnecting', { graceMs });
        broadcastCallUpdate(activeCall);
      }
      scheduleGrace(me);
      broadcastQueue();
    });
  });
}
