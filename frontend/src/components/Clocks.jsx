import { useNow } from '../hooks/useNow.js';
import { formatDuration } from '../lib/format.js';

// separate components so only the clock re-renders when it ticks
const TICK_MS = 250;

export function Elapsed({ since, clockOffset = 0, placeholder = '--:--' }) {
  const now = useNow(TICK_MS, Boolean(since));
  return since ? formatDuration((now + clockOffset - since) / 1000) : placeholder;
}

export function Countdown({ deadline }) {
  const now = useNow(TICK_MS);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
