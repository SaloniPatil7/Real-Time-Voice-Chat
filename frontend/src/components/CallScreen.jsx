import { useAudioLevel } from '../hooks/useAudioLevel.js';
import { useMedia, useSession } from '../hooks/useSession.js';
import { roleLabel } from '../lib/format.js';
import { media } from '../lib/media.js';
import { actions } from '../lib/session.js';
import { ChatPanel } from './ChatPanel.jsx';
import { Countdown, Elapsed } from './Clocks.jsx';
import { Avatar, Notice, StatusBadge } from './common.jsx';
import { MicIcon, MicOffIcon, PhoneOffIcon, RetryIcon, VolumeIcon } from './icons.jsx';

const AUDIO_STATUS = {
  connected: { tone: 'ok', label: 'Connected' },
  reconnecting: { tone: 'warn', label: 'Reconnecting audio...' },
  failed: { tone: 'error', label: 'Audio failed' },
};

function callStatus(session, audio) {
  if (session.connection !== 'connected') return { tone: 'warn', label: 'Reconnecting to server...' };
  if (session.peerReconnecting) return { tone: 'error', label: `${roleLabel(session.call.peer?.role)} disconnected` };
  return AUDIO_STATUS[audio.connection] ?? { tone: 'pending', label: 'Connecting...' };
}

export function CallScreen() {
  const session = useSession();
  const audio = useMedia();
  const { call, messages, identity, peerReconnecting, connection, clockOffset } = session;
  const peer = call.peer ?? { name: 'Unknown', role: identity.role === 'agent' ? 'customer' : 'agent' };
  const remoteLevelRef = useAudioLevel('remote');
  const localLevelRef = useAudioLevel('local');

  return (
    <div className="call-layout">
      <section className="card call-panel" aria-label="Call">
        <div className="peer">
          <div className="level-ring" ref={remoteLevelRef}>
            <Avatar name={peer.name} size="lg" />
          </div>
          <p className="eyebrow">Connected with</p>
          <h1>{peer.name}</h1>
          <p className="muted">
            {roleLabel(peer.role)}
            {peer.muted && ' (muted)'}
          </p>
          <StatusBadge {...callStatus(session, audio)} />
          <div className="timer" aria-label="Call duration">
            <Elapsed since={call.startedAt} clockOffset={clockOffset} />
          </div>
        </div>

        <div className="call-notices">
          {peerReconnecting && (
            <Notice tone="warn">
              {peer.name} lost connection.{' '}
              {peerReconnecting.deadline ? (
                <>
                  Waiting <Countdown deadline={peerReconnecting.deadline} />s for them to come back...
                </>
              ) : (
                'Waiting for them to come back...'
              )}
            </Notice>
          )}
          {audio.audioBlocked && (
            <Notice
              tone="info"
              action={
                <button type="button" className="btn btn-primary btn-sm" onClick={media.resumeAudio}>
                  <VolumeIcon size={16} /> Enable audio
                </button>
              }
            >
              Your browser paused the call audio.
            </Notice>
          )}
          {audio.micError && (
            <Notice
              tone="error"
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => media.retryMic()}>
                  <RetryIcon size={16} /> Retry
                </button>
              }
            >
              {audio.micError} You can still hear {peer.name}.
            </Notice>
          )}
          {audio.failure && (
            <Notice
              tone="error"
              action={
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => media.retryConnection()}>
                  <RetryIcon size={16} /> Retry
                </button>
              }
            >
              {audio.failure}
            </Notice>
          )}
        </div>

        <div className="controls">
          <button
            type="button"
            className={`control${audio.muted ? ' active' : ''}`}
            onClick={actions.toggleMute}
            aria-pressed={audio.muted}
          >
            {audio.muted ? <MicOffIcon /> : <MicIcon />}
            <span>{audio.muted ? 'Unmute' : 'Mute'}</span>
            <span className="mic-level" ref={localLevelRef} aria-hidden="true" />
          </button>
          <button type="button" className="control control-danger" onClick={actions.endCall}>
            <PhoneOffIcon />
            <span>End call</span>
          </button>
        </div>
      </section>

      <ChatPanel messages={messages} myRole={identity.role} disabled={connection !== 'connected'} />
    </div>
  );
}
