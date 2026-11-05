import { createStore } from './createStore.js';
import { rtcConfig } from './rtcConfig.js';
import { socket } from './socket.js';

const CONNECT_TIMEOUT_MS = 20_000;
const MAX_AUTO_RESTARTS = 2;

const AUDIO_FAILED =
  "Couldn't connect audio. Your network may be blocking peer-to-peer traffic (a TURN server would fix this).";

export function describeMicError(error) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return 'Voice calls need a secure page. Open the app on localhost or over HTTPS.';
  }
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Microphone access is blocked. Allow it from the icon in the address bar, then try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Connect one and try again.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your microphone is busy in another app or could not be started.';
    default:
      return 'Could not access the microphone.';
  }
}

const initialState = {
  connection: 'idle', // idle | connecting | connected | reconnecting | failed
  muted: false,
  micError: null,
  failure: null,
  audioBlocked: false,
};

// Handles the mic, the RTCPeerConnection and playing the remote audio.
// The server says when to (re)connect with webrtc:start, and the agent is always the one who offers.
class CallMedia {
  store = createStore(initialState);
  stream = null;
  pc = null;
  negotiationId = null;
  pendingCandidates = [];
  tasks = Promise.resolve();
  epoch = 0;
  restarts = 0;
  connectTimer = null;
  audio = null;
  audioContext = null;
  meters = { local: null, remote: null };

  set(patch) {
    this.store.setState(patch);
  }

  // Start/signal handling runs one step at a time, otherwise an offer can show up while
  // we're still waiting on the mic permission and there's no peer connection yet.
  // epoch changes on pause/stop so anything queued for the old call gets skipped.
  enqueue(task) {
    const epoch = this.epoch;
    this.tasks = this.tasks
      .then(() => (epoch === this.epoch ? task(epoch) : undefined))
      .catch((error) => console.error('[media]', error));
  }

  async ensureMic(epoch = this.epoch) {
    if (this.stream?.getAudioTracks().some((t) => t.readyState === 'live')) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('insecure context');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      if (epoch !== this.epoch) {
        // call ended while the permission prompt was open
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stream = stream;
      this.applyMute();
      this.attachMeter('local', stream);
      this.set({ micError: null });
      return true;
    } catch (error) {
      this.set({ micError: describeMicError(error) });
      return false;
    }
  }

  start({ negotiationId, initiator }) {
    this.enqueue((epoch) => this.startConnection(negotiationId, initiator, epoch));
  }

  handleSignal(signal) {
    this.enqueue(() => this.applySignal(signal));
  }

  async startConnection(negotiationId, initiator, epoch) {
    this.closePeer();
    this.negotiationId = negotiationId;
    this.set({ connection: this.store.getState().connection === 'connected' ? 'reconnecting' : 'connecting', failure: null });

    // if there's no mic we still connect (receive only) so the user can hear the other side
    await this.ensureMic(epoch);
    if (epoch !== this.epoch) return;

    const pc = new RTCPeerConnection(rtcConfig);
    this.pc = pc;
    if (this.stream) this.stream.getAudioTracks().forEach((track) => pc.addTrack(track, this.stream));
    else pc.addTransceiver('audio', { direction: 'recvonly' });

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) socket.emit('webrtc:signal', { negotiationId, candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ streams, track }) => this.playRemote(streams[0] ?? new MediaStream([track]));
    pc.onconnectionstatechange = () => this.onConnectionStateChange(pc);
    this.armConnectTimeout(pc);

    if (initiator) {
      await pc.setLocalDescription(await pc.createOffer());
      socket.emit('webrtc:signal', { negotiationId, description: pc.localDescription.toJSON() });
    }
  }

  async applySignal({ negotiationId, description, candidate }) {
    const pc = this.pc;
    if (!pc || negotiationId !== this.negotiationId) return;

    if (description) {
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        await pc.setLocalDescription(await pc.createAnswer());
        socket.emit('webrtc:signal', { negotiationId, description: pc.localDescription.toJSON() });
      }
      for (const queued of this.pendingCandidates.splice(0)) await this.addCandidate(pc, queued);
    } else if (candidate) {
      // candidates can arrive before the offer/answer they belong to
      if (pc.remoteDescription) await this.addCandidate(pc, candidate);
      else this.pendingCandidates.push(candidate);
    }
  }

  async addCandidate(pc, candidate) {
    try {
      await pc.addIceCandidate(candidate);
    } catch (error) {
      console.warn('[media] ignored ICE candidate', error);
    }
  }

  onConnectionStateChange(pc) {
    if (pc !== this.pc) return;
    switch (pc.connectionState) {
      case 'connected':
        clearTimeout(this.connectTimer);
        this.restarts = 0;
        this.set({ connection: 'connected', failure: null });
        socket.emit('call:media-connected');
        break;
      case 'disconnected':
        // usually recovers by itself
        this.set({ connection: 'reconnecting' });
        break;
      case 'failed':
        this.recover();
        break;
    }
  }

  armConnectTimeout(pc) {
    clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      if (pc === this.pc && pc.connectionState !== 'connected') this.recover();
    }, CONNECT_TIMEOUT_MS);
  }

  recover() {
    clearTimeout(this.connectTimer);
    if (this.restarts < MAX_AUTO_RESTARTS) {
      this.restarts += 1;
      this.set({ connection: 'reconnecting' });
      socket.emit('webrtc:restart');
    } else {
      this.closePeer();
      this.set({ connection: 'failed', failure: AUDIO_FAILED });
    }
  }

  retryConnection() {
    this.restarts = 0;
    this.set({ connection: 'connecting', failure: null });
    socket.emit('webrtc:restart');
  }

  async retryMic() {
    if (await this.ensureMic()) socket.emit('webrtc:restart');
  }

  playRemote(stream) {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.autoplay = true;
    }
    if (this.audio.srcObject !== stream) {
      this.audio.srcObject = stream;
      this.attachMeter('remote', stream);
    }
    this.resumeAudio();
  }

  // after a refresh there's been no click yet, so the browser can block autoplay
  resumeAudio = () => {
    this.audioContext?.resume().catch(() => {});
    if (!this.audio?.srcObject) return;
    this.audio
      .play()
      .then(() => this.set({ audioBlocked: false }))
      .catch((error) => {
        if (error.name === 'NotAllowedError') this.set({ audioBlocked: true });
      });
  };

  setMuted(muted) {
    this.set({ muted });
    this.applyMute();
  }

  applyMute() {
    const { muted } = this.store.getState();
    this.stream?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  // other side dropped: close the connection but keep the mic for when they come back
  pause() {
    this.epoch += 1;
    this.closePeer();
    this.set({ connection: 'reconnecting', failure: null });
  }

  stop() {
    this.epoch += 1;
    this.closePeer();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.audio) this.audio.srcObject = null;
    for (const kind of Object.keys(this.meters)) this.detachMeter(kind);
    this.restarts = 0;
    this.set(initialState);
  }

  closePeer() {
    clearTimeout(this.connectTimer);
    this.pendingCandidates = [];
    this.negotiationId = null;
    if (!this.pc) return;
    this.pc.onicecandidate = this.pc.ontrack = this.pc.onconnectionstatechange = null;
    this.pc.close();
    this.pc = null;
  }

  // audio level meters, only used for the UI

  attachMeter(kind, stream) {
    try {
      this.audioContext ??= new AudioContext();
      this.detachMeter(kind);
      const source = this.audioContext.createMediaStreamSource(stream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.meters[kind] = { source, analyser, samples: new Uint8Array(analyser.fftSize) };
    } catch {
      // not important if this fails
    }
  }

  detachMeter(kind) {
    this.meters[kind]?.source.disconnect();
    this.meters[kind] = null;
  }

  level(kind) {
    const meter = this.meters[kind];
    if (!meter) return 0;
    meter.analyser.getByteTimeDomainData(meter.samples);
    let sum = 0;
    for (const sample of meter.samples) sum += ((sample - 128) / 128) ** 2;
    return Math.min(1, Math.sqrt(sum / meter.samples.length) * 4);
  }

  // used by the e2e test to check audio is actually arriving
  async inboundAudioStats() {
    if (!this.pc) return null;
    const stats = await this.pc.getStats();
    for (const report of stats.values()) {
      if (report.type === 'inbound-rtp' && report.kind === 'audio') {
        return { bytesReceived: report.bytesReceived, packetsReceived: report.packetsReceived };
      }
    }
    return null;
  }
}

export const media = new CallMedia();
