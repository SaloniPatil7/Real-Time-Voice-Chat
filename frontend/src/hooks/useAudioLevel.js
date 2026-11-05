import { useEffect, useRef } from 'react';
import { media } from '../lib/media.js';

// sets a --level css variable (0 to 1) on the element every frame, without re-rendering
export function useAudioLevel(kind) {
  const ref = useRef(null);

  useEffect(() => {
    let frame;
    const tick = () => {
      ref.current?.style.setProperty('--level', media.level(kind).toFixed(3));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [kind]);

  return ref;
}
