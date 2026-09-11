import { useEffect, useState } from 'react';

let readyPromise: Promise<void> | null = null;

const FONT_FAMILIES = ['"IBM Plex Sans"', '"Signika"'];
const FONT_WEIGHTS = [400, 500, 600, 700];
const FALLBACK_TIMEOUT_MS = 3000;

function resolveFonts(): Promise<void> {
  if (readyPromise) return readyPromise;
  if (typeof document === 'undefined' || !document.fonts || typeof document.fonts.load !== 'function') {
    readyPromise = Promise.resolve();
    return readyPromise;
  }

  const loads = FONT_FAMILIES.flatMap(family =>
    FONT_WEIGHTS.map(weight => document.fonts.load(`${weight} 1em ${family}`)),
  );
  const loaded = Promise.all(loads).then(
    () => {},
    () => {},
  );

  readyPromise = Promise.race([
    loaded,
    new Promise<void>(resolve => setTimeout(resolve, FALLBACK_TIMEOUT_MS)),
  ]);
  return readyPromise;
}

export function useFontsReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    resolveFonts().then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  return ready;
}