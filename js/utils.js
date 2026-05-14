// Pure utility functions — no imports, no side effects

export function generateUUID() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export function hzToMidi(hz) {
  return Math.round(12 * Math.log2(hz / 440) + 69);
}

export function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function midiToPitch(midi) {
  const octave = Math.floor(midi / 12) - 1;
  const note = CHROMATIC[midi % 12];
  return `${note}${octave}`;
}

export function pitchToMidi(pitchStr) {
  if (!pitchStr || pitchStr === 'rest') return null;
  const match = pitchStr.match(/^([A-G])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return null;
  const [, step, acc, octStr] = match;
  const octave = parseInt(octStr);
  let semitone = CHROMATIC.indexOf(step);
  if (semitone === -1) return null;
  semitone += (acc.split('').reduce((s, c) => s + (c === '#' ? 1 : -1), 0));
  return (octave + 1) * 12 + semitone;
}

export function nearestSemitoneHz(hz) {
  return midiToHz(Math.round(hzToMidi(hz)));
}

export const DURATION_BEATS = {
  whole: 4,
  half: 2,
  quarter: 1,
  eighth: 0.5,
  sixteenth: 0.25,
  '32nd': 0.125,
};

export const BEATS_TO_DURATION = {
  4: 'whole',
  2: 'half',
  1: 'quarter',
  0.5: 'eighth',
  0.25: 'sixteenth',
  0.125: '32nd',
};

export const VEX_DURATION_MAP = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  sixteenth: '16',
  '32nd': '32',
};

export function durationToBeats(name) {
  return DURATION_BEATS[name] ?? 1;
}

export function beatsToNearestDuration(beats) {
  const grid = [4, 2, 1, 0.5, 0.25, 0.125];
  return grid.reduce((best, g) =>
    Math.abs(g - beats) < Math.abs(best - beats) ? g : best
  );
}

export function pitchToVexKey(pitch) {
  if (!pitch || pitch === 'rest') return 'B/4';
  const match = pitch.match(/^([A-G])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return 'C/4';
  return `${match[1]}${match[2]}/${match[3]}`;
}

export function clampMidi(midi) {
  return Math.max(21, Math.min(108, midi));
}

// Key signature → array of sharped/flatted steps
const KEY_ACCIDENTALS = {
  'C':  { type: null, steps: [] },
  'G':  { type: '#', steps: ['F'] },
  'D':  { type: '#', steps: ['F', 'C'] },
  'A':  { type: '#', steps: ['F', 'C', 'G'] },
  'E':  { type: '#', steps: ['F', 'C', 'G', 'D'] },
  'B':  { type: '#', steps: ['F', 'C', 'G', 'D', 'A'] },
  'F':  { type: 'b', steps: ['B'] },
  'Bb': { type: 'b', steps: ['B', 'E'] },
  'Eb': { type: 'b', steps: ['B', 'E', 'A'] },
  'Ab': { type: 'b', steps: ['B', 'E', 'A', 'D'] },
  'Db': { type: 'b', steps: ['B', 'E', 'A', 'D', 'G'] },
  'Gb': { type: 'b', steps: ['B', 'E', 'A', 'D', 'G', 'C'] },
};

export function getKeyAccidental(step, keySignature) {
  const info = KEY_ACCIDENTALS[keySignature];
  if (!info || !info.type) return null;
  if (info.steps.includes(step)) return info.type;
  return null;
}

export function needsAccidentalMark(note, keySignature) {
  // Returns the accidental symbol to show, or null if implied by key sig
  const match = note.pitch?.match(/^([A-G])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return null;
  const [, step, acc] = match;
  const keyAcc = getKeyAccidental(step, keySignature);
  if (note.accidental === 'n') return 'n'; // forced natural
  if (acc === '#' && keyAcc === '#') return null; // implied
  if (acc === 'b' && keyAcc === 'b') return null; // implied
  if (acc === '') return null;
  return acc || null;
}

export function formatTimeSig(num, den) {
  return `${num}/${den}`;
}
