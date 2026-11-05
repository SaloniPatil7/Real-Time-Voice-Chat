import { randomUUID } from 'node:crypto';

export const ROLES = ['customer', 'agent'];

// clientId is what a tab uses to resume its session, so it never gets sent to other users.
// Other users only see publicId.
export class Store {
  users = new Map(); // clientId -> user
  queue = []; // { customerId, since }
  calls = new Map(); // callId -> call

  getOrCreateUser({ clientId, name, role }) {
    let user = this.users.get(clientId);
    if (!user) {
      user = {
        clientId,
        publicId: randomUUID(),
        name,
        role,
        socketId: null,
        online: false,
        status: 'idle', // idle | waiting | in-call
        callId: null,
        timer: null,
        missedEnd: null, // call:ended payload if the call ended while they were offline
      };
      this.users.set(clientId, user);
    }
    return user;
  }

  removeUser(user) {
    clearTimeout(user.timer);
    this.users.delete(user.clientId);
  }

  onlineUsers(role) {
    return [...this.users.values()].filter((u) => u.online && u.role === role);
  }

  enqueue(user) {
    if (!this.queue.some((entry) => entry.customerId === user.clientId)) {
      this.queue.push({ customerId: user.clientId, since: Date.now() });
    }
    user.status = 'waiting';
  }

  dequeue(user) {
    this.queue = this.queue.filter((entry) => entry.customerId !== user.clientId);
    if (user.status === 'waiting') user.status = 'idle';
  }

  // customers who are offline (mid refresh) are hidden but keep their place
  waitingEntries() {
    return this.queue
      .map((entry) => ({ user: this.users.get(entry.customerId), since: entry.since }))
      .filter(({ user }) => user?.online && user.status === 'waiting');
  }

  waitingList() {
    return this.waitingEntries().map(({ user, since }) => ({ customerId: user.publicId, name: user.name, since }));
  }

  findWaitingCustomer(publicId) {
    return this.waitingEntries().find(({ user }) => user.publicId === publicId)?.user ?? null;
  }

  queuePosition(user) {
    const index = this.waitingEntries().findIndex((entry) => entry.user === user);
    return index === -1 ? null : index + 1;
  }

  createCall(customer, agent) {
    const call = {
      id: randomUUID(),
      customerId: customer.clientId,
      agentId: agent.clientId,
      status: 'connecting', // becomes 'active' once audio connects
      createdAt: Date.now(),
      startedAt: null,
      negotiationId: 0,
      muted: {},
      messages: [],
    };
    this.calls.set(call.id, call);
    for (const user of [customer, agent]) {
      user.status = 'in-call';
      user.callId = call.id;
    }
    return call;
  }

  callOf(user) {
    return (user.callId && this.calls.get(user.callId)) || null;
  }

  participants(call) {
    return [this.users.get(call.customerId), this.users.get(call.agentId)].filter(Boolean);
  }

  peerOf(call, user) {
    return this.users.get(user.clientId === call.customerId ? call.agentId : call.customerId) ?? null;
  }

  addMessage(call, sender, text) {
    const message = { id: randomUUID(), from: sender.role, name: sender.name, text, ts: Date.now() };
    call.messages.push(message);
    return message;
  }

  // returns call duration in seconds
  finishCall(call) {
    for (const user of this.participants(call)) {
      user.status = 'idle';
      user.callId = null;
    }
    this.calls.delete(call.id);
    return call.startedAt ? Math.round((Date.now() - call.startedAt) / 1000) : 0;
  }

  callView(call, user, { withMessages = false } = {}) {
    const peer = this.peerOf(call, user);
    return {
      id: call.id,
      status: call.status,
      createdAt: call.createdAt,
      startedAt: call.startedAt,
      selfMuted: Boolean(call.muted[user.clientId]),
      peer: peer && {
        name: peer.name,
        role: peer.role,
        online: peer.online,
        muted: Boolean(call.muted[peer.clientId]),
      },
      ...(withMessages && { messages: call.messages }),
    };
  }

  sessionView(user) {
    const call = this.callOf(user);
    return {
      user: { name: user.name, role: user.role, status: user.status },
      call: call ? this.callView(call, user, { withMessages: true }) : null,
      queuePosition: this.queuePosition(user),
      agentsOnline: this.onlineUsers('agent').length,
      waiting: user.role === 'agent' ? this.waitingList() : [],
      serverNow: Date.now(),
    };
  }
}
