// Text-to-speech for listen mode, on the browser's built-in voices (free, works offline on most phones).

export function speechSupported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
}

function langOf(text: string) {
  const hangul = (text.match(/[가-힣]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  return hangul >= latin * 0.3 ? 'ko-KR' : 'en-US';
}

function voiceFor(lang: string) {
  const voices = window.speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return voices.find(v => v.lang === lang && v.localService) ?? voices.find(v => v.lang === lang) ?? voices.find(v => v.lang.startsWith(prefix));
}

let generation = 0;

export function speak(text: string, rate = 1): Promise<void> {
  if (!speechSupported() || !text.trim()) return Promise.resolve();
  const mine = generation;
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = langOf(text);
    const voice = voiceFor(u.lang);
    if (voice) u.voice = voice;
    u.rate = rate;
    // Some engines never fire onend; resolve after a generous estimate so playback can't hang.
    const fallback = setTimeout(resolve, 2000 + (text.length * 180) / rate);
    const finish = () => {
      clearTimeout(fallback);
      resolve();
    };
    u.onend = finish;
    u.onerror = finish;
    if (mine !== generation) return finish();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  generation += 1;
  if (speechSupported()) window.speechSynthesis.cancel();
}

// Keeps the screen on during listen mode, where the phone sits in a pocket-adjacent hand.
export async function keepAwake(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> } };
    const lock = await nav.wakeLock?.request('screen');
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}
