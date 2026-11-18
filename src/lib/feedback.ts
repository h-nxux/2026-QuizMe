// Haptics and tiny synthesized sounds. Both respect the user's settings; sound is off by default
// because the main use case is a quiet subway car.
import { getSnapshot } from '../data/store';

type Cue = 'tap' | 'correct' | 'wrong' | 'stop' | 'finish';

const VIBRATION: Record<Cue, number | number[]> = {
  tap: 8,
  correct: 18,
  wrong: [30, 40, 30],
  stop: [20, 60, 20, 60, 40],
  finish: [30, 50, 30, 50, 80],
};

const TONES: Record<Cue, [number, number][]> = {
  tap: [[660, 0.04]],
  correct: [[880, 0.08], [1320, 0.12]],
  wrong: [[220, 0.12], [180, 0.16]],
  stop: [[660, 0.08], [880, 0.08], [1100, 0.14]],
  finish: [[660, 0.1], [880, 0.1], [1100, 0.1], [1320, 0.2]],
};

let audio: AudioContext | null = null;

function play(cue: Cue) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    let t = audio.currentTime;
    for (const [freq, dur] of TONES[cue]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
      t += dur * 0.9;
    }
  } catch {
    // audio is a nicety
  }
}

export function cue(kind: Cue) {
  const { settings } = getSnapshot();
  if (settings.haptics && 'vibrate' in navigator) {
    try {
      navigator.vibrate(VIBRATION[kind]);
    } catch {
      // unsupported (iOS Safari)
    }
  }
  if (settings.sound) play(kind);
}
