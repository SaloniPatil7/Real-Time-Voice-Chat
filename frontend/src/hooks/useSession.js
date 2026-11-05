import { useSyncExternalStore } from 'react';
import { media } from '../lib/media.js';
import { session } from '../lib/session.js';

export const useSession = () => useSyncExternalStore(session.subscribe, session.getState);

export const useMedia = () => useSyncExternalStore(media.store.subscribe, media.store.getState);
