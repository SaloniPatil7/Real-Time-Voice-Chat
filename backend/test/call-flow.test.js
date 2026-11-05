import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, test } from 'node:test';
import { io as connectClient } from 'socket.io-client';
import { createApp } from '../src/app.js';

const GRACE_MS = 300;
let server;
let url;
let sockets;

beforeEach(async () => {
  server = createApp({ graceMs: GRACE_MS, log: false });
  await new Promise((resolve) => server.httpServer.listen(0, resolve));
  url = `http://localhost:${server.httpServer.address().port}`;
  sockets = [];
});

afterEach(async () => {
  for (const socket of sockets) socket.disconnect();
  server.io.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
});

function connect(auth) {
  const socket = connectClient(url, { auth, transports: ['websocket'], reconnection: false, forceNew: true });
  sockets.push(socket);
  return socket;
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`timed out waiting for ${event}`));
    }, timeoutMs);
    const listener = (payload) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function join(name, role, clientId = randomUUID()) {
  const socket = connect({ clientId, name, role });
  const state = await waitFor(socket, 'session:state');
  return { socket, state, clientId };
}

async function queueCustomer(customer, agent) {
  const listed = waitFor(agent.socket, 'queue:update', ({ waiting }) => waiting.length > 0);
  assert.deepEqual(await customer.socket.emitWithAck('queue:join'), { ok: true });
  return (await listed).waiting[0];
}

async function startCall() {
  const agent = await join('Asha', 'agent');
  const customer = await join('Ravi', 'customer');
  const { customerId } = await queueCustomer(customer, agent);

  const agentStarted = waitFor(agent.socket, 'call:started');
  const customerStarted = waitFor(customer.socket, 'call:started');
  const agentStart = waitFor(agent.socket, 'webrtc:start');
  const customerStart = waitFor(customer.socket, 'webrtc:start');
  assert.deepEqual(await agent.socket.emitWithAck('call:accept', { customerId }), { ok: true });

  return {
    agent,
    customer,
    customerId,
    agentCall: await agentStarted,
    customerCall: await customerStarted,
    agentStart: await agentStart,
    customerStart: await customerStart,
  };
}

test('rejects a handshake without a valid identity', async () => {
  const socket = connect({ clientId: 'x', name: '', role: 'admin' });
  const error = await waitFor(socket, 'connect_error');
  assert.equal(error.message, 'invalid_session');
});

test('agent sees a queued customer and accepts; both sides get the call and negotiation roles', async () => {
  const { agentCall, customerCall, agentStart, customerStart, customerId } = await startCall();

  assert.equal(typeof customerId, 'string');
  assert.deepEqual(agentCall.peer, { name: 'Ravi', role: 'customer', online: true, muted: false });
  assert.deepEqual(customerCall.peer, { name: 'Asha', role: 'agent', online: true, muted: false });
  assert.equal(agentCall.id, customerCall.id);
  assert.deepEqual(agentStart, { negotiationId: 1, initiator: true });
  assert.deepEqual(customerStart, { negotiationId: 1, initiator: false });
});

test('never exposes another user\'s resume token', async () => {
  const agent = await join('Asha', 'agent');
  const customer = await join('Ravi', 'customer');
  const listed = await queueCustomer(customer, agent);
  assert.notEqual(listed.customerId, customer.clientId);
});

test('customer sees their queue position and agent count', async () => {
  await join('Asha', 'agent');
  const first = await join('Ravi', 'customer');
  const second = await join('Meera', 'customer');
  await first.socket.emitWithAck('queue:join');
  const status = waitFor(second.socket, 'queue:status', ({ position }) => position === 2);
  await second.socket.emitWithAck('queue:join');
  assert.deepEqual(await status, { position: 2, agentsOnline: 1 });
});

test('only one agent can accept the same customer', async () => {
  const agentA = await join('Asha', 'agent');
  const agentB = await join('Bilal', 'agent');
  const customer = await join('Ravi', 'customer');
  const { customerId } = await queueCustomer(customer, agentA);

  const results = await Promise.all([
    agentA.socket.emitWithAck('call:accept', { customerId }),
    agentB.socket.emitWithAck('call:accept', { customerId }),
  ]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual(results.find((r) => !r.ok), { ok: false, error: 'That customer is no longer waiting.' });
});

test('declining returns the customer to idle with a notice', async () => {
  const agent = await join('Asha', 'agent');
  const customer = await join('Ravi', 'customer');
  const { customerId } = await queueCustomer(customer, agent);

  const declined = waitFor(customer.socket, 'call:declined');
  assert.deepEqual(await agent.socket.emitWithAck('call:decline', { customerId }), { ok: true });
  assert.deepEqual(await declined, { agentName: 'Asha' });
  assert.equal(server.store.queue.length, 0);
});

test('relays WebRTC signals for the current negotiation only', async () => {
  const { agent, customer } = await startCall();
  const received = waitFor(customer.socket, 'webrtc:signal');
  agent.socket.emit('webrtc:signal', { negotiationId: 0, description: { type: 'offer', sdp: 'stale' } });
  agent.socket.emit('webrtc:signal', { negotiationId: 1, description: { type: 'offer', sdp: 'fresh' } });
  assert.equal((await received).description.sdp, 'fresh');
});

test('chat messages reach both sides with sender and server timestamp', async () => {
  const { agent, customer } = await startCall();
  const atAgent = waitFor(agent.socket, 'chat:message');
  const atCustomer = waitFor(customer.socket, 'chat:message');
  assert.deepEqual(await customer.socket.emitWithAck('chat:send', { text: '  Hello, I need help  ' }), { ok: true });

  const [a, c] = await Promise.all([atAgent, atCustomer]);
  assert.deepEqual(a, c);
  assert.equal(a.text, 'Hello, I need help');
  assert.equal(a.from, 'customer');
  assert.equal(a.name, 'Ravi');
  assert.ok(Math.abs(a.ts - Date.now()) < 1000);

  assert.equal((await customer.socket.emitWithAck('chat:send', { text: '   ' })).ok, false);
  assert.equal((await customer.socket.emitWithAck('chat:send', { text: 'x'.repeat(501) })).ok, false);
});

test('call start time and mute state are shared with both peers', async () => {
  const { agent, customer } = await startCall();

  const started = waitFor(agent.socket, 'call:updated', (call) => call.startedAt);
  await customer.socket.emitWithAck('call:media-connected');
  const startedCall = await started;
  assert.equal(startedCall.status, 'active');

  const muted = waitFor(agent.socket, 'call:updated', (call) => call.peer.muted);
  await customer.socket.emitWithAck('call:mute', { muted: true });
  assert.equal((await muted).startedAt, startedCall.startedAt);
});

test('hanging up ends the call for both sides', async () => {
  const { agent, customer } = await startCall();
  const atAgent = waitFor(agent.socket, 'call:ended');
  const atCustomer = waitFor(customer.socket, 'call:ended');
  assert.deepEqual(await agent.socket.emitWithAck('call:end'), { ok: true });

  assert.deepEqual(await atAgent, { reason: 'hangup', by: 'you', peer: { name: 'Ravi', role: 'customer' }, durationSec: 0 });
  assert.deepEqual(await atCustomer, { reason: 'hangup', by: 'peer', peer: { name: 'Asha', role: 'agent' }, durationSec: 0 });
  assert.equal(server.store.calls.size, 0);
});

test('a refreshed user rejoins within the grace period with chat history', async () => {
  const { agent, customer } = await startCall();
  await customer.socket.emitWithAck('chat:send', { text: 'before refresh' });

  const reconnecting = waitFor(agent.socket, 'peer:reconnecting');
  customer.socket.disconnect();
  assert.deepEqual(await reconnecting, { graceMs: GRACE_MS });

  const rejoined = waitFor(agent.socket, 'peer:rejoined');
  const agentRestart = waitFor(agent.socket, 'webrtc:start');
  const again = connect({ clientId: customer.clientId, name: 'Ravi', role: 'customer' });
  const customerRestart = waitFor(again, 'webrtc:start');
  const state = await waitFor(again, 'session:state');

  assert.equal(state.user.status, 'in-call');
  assert.equal(state.call.peer.name, 'Asha');
  assert.deepEqual(state.call.messages.map((m) => m.text), ['before refresh']);
  await rejoined;
  assert.deepEqual(await agentRestart, { negotiationId: 2, initiator: true });
  assert.deepEqual(await customerRestart, { negotiationId: 2, initiator: false });

  await sleep(GRACE_MS + 100);
  assert.equal(server.store.calls.size, 1, 'call must survive past the original grace deadline');
});

test('the call ends for the other side when the grace period expires', async () => {
  const { agent, customer } = await startCall();
  const ended = waitFor(agent.socket, 'call:ended');
  customer.socket.disconnect();
  assert.deepEqual(await ended, { reason: 'disconnected', by: 'peer', peer: { name: 'Ravi', role: 'customer' }, durationSec: 0 });

  // reconnecting after the grace period
  const late = await join('Ravi', 'customer', customer.clientId);
  assert.equal(late.state.call, null);
  assert.equal(late.state.endedWhileAway.reason, 'disconnected');
  assert.equal(late.state.endedWhileAway.by, 'you');
});

test('a waiting customer keeps their queue spot across a refresh', async () => {
  const agent = await join('Asha', 'agent');
  const customer = await join('Ravi', 'customer');
  await queueCustomer(customer, agent);

  const hidden = waitFor(agent.socket, 'queue:update', ({ waiting }) => waiting.length === 0);
  customer.socket.disconnect();
  await hidden;

  const back = await join('Ravi', 'customer', customer.clientId);
  assert.equal(back.state.user.status, 'waiting');
  assert.equal(back.state.queuePosition, 1);
});

test('a second tab with the same identity replaces the first', async () => {
  const first = await join('Ravi', 'customer');
  const replaced = waitFor(first.socket, 'session:replaced');
  const second = await join('Ravi', 'customer', first.clientId);
  await replaced;
  assert.equal(second.state.user.name, 'Ravi');
  assert.equal(server.store.users.size, 1);
});

test('signing out during a call ends it immediately', async () => {
  const { agent, customer } = await startCall();
  const ended = waitFor(agent.socket, 'call:ended');
  assert.deepEqual(await customer.socket.emitWithAck('session:logout'), { ok: true });
  assert.equal((await ended).reason, 'left');
  assert.equal(server.store.users.size, 1);
});

test('rejects actions that do not fit the user\'s role or state', async () => {
  const agent = await join('Asha', 'agent');
  const customer = await join('Ravi', 'customer');

  assert.equal((await agent.socket.emitWithAck('queue:join')).ok, false);
  assert.equal((await customer.socket.emitWithAck('queue:leave')).ok, false);
  assert.equal((await customer.socket.emitWithAck('call:accept', { customerId: 'nope' })).ok, false);
  assert.equal((await customer.socket.emitWithAck('chat:send', { text: 'hi' })).ok, false);
  assert.equal((await customer.socket.emitWithAck('call:end')).ok, false);
});
