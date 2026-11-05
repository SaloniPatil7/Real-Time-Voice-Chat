const env = import.meta.env;
const list = (value) => value.split(',').map((s) => s.trim()).filter(Boolean);

const stunUrls = list(env.VITE_STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302');

// TURN is optional, only needed on networks that block peer to peer
export const rtcConfig = {
  iceServers: [
    { urls: stunUrls },
    ...(env.VITE_TURN_URL
      ? [{ urls: list(env.VITE_TURN_URL), username: env.VITE_TURN_USERNAME, credential: env.VITE_TURN_CREDENTIAL }]
      : []),
  ],
};
