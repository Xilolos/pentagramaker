import {
  generateUUID,
  durationToBeats,
  beatsToNearestDuration,
  BEATS_TO_DURATION,
  pitchToMidi,
  midiToPitch,
} from './utils.js';

const GRID = [4, 2, 1, 0.5, 0.25, 0.125];

export class Quantizer {
  constructor() {
    this._tempo = 120;
    this._tempoSnap = 0.8;
    this._timeSig = { num: 4, den: 4 };
    this._accBeats = 0;         // accumulated beats in current measure
    this._pendingNote = null;   // { pitch, startTime }
    this._recentDurations = []; // for time sig detection
    this._onMeasureFull = null;
    this._onNoteReady = null;
  }

  setTempo(bpm) { this._tempo = Math.max(20, Math.min(300, bpm)); }
  setTempoSnap(pct) { this._tempoSnap = Math.max(0, Math.min(1, pct)); }
  setTimeSignature(num, den) { this._timeSig = { num, den }; }
  onMeasureFull(cb) { this._onMeasureFull = cb; }
  onNoteReady(cb) { this._onNoteReady = cb; }

  reset() {
    this._accBeats = 0;
    this._pendingNote = null;
    this._recentDurations = [];
  }

  beginNote(pitch, startTime) {
    this._pendingNote = { pitch, startTime };
  }

  endNote(endInfo) {
    // endInfo: { pitch, startTime, endTime } OR just an endTime if silence
    const pending = this._pendingNote;
    if (!pending) return null;
    this._pendingNote = null;

    const pitch = pending.pitch;
    const startTime = pending.startTime;
    const endTime = endInfo.endTime ?? Date.now();

    const durationMs = Math.max(50, endTime - startTime);
    const rawBeats = (durationMs / 1000) * (this._tempo / 60);

    const quantizedBeats = this._quantizeBeats(rawBeats);
    this._recentDurations.push(quantizedBeats);
    if (this._recentDurations.length > 16) this._recentDurations.shift();

    return this._addToMeasure(pitch, quantizedBeats);
  }

  endSilence(endInfo) {
    // Called when silence detected — end any pending note first
    const noteResult = this.endNote(endInfo);

    // Also add a rest for the silence duration
    if (endInfo.startTime && endInfo.endTime) {
      // Don't add rest if duration is tiny (< 0.1 beats)
      const silenceMs = Math.max(0, endInfo.endTime - endInfo.startTime);
      const silenceBeats = (silenceMs / 1000) * (this._tempo / 60);
      if (silenceBeats >= 0.1) {
        const qBeats = this._quantizeBeats(silenceBeats);
        this._addToMeasure('rest', qBeats);
      }
    }

    return noteResult;
  }

  _quantizeBeats(rawBeats) {
    const nearest = beatsToNearestDuration(rawBeats);
    if (this._tempoSnap >= 0.5) return nearest;
    const blended = rawBeats * (1 - this._tempoSnap) + nearest * this._tempoSnap;
    return beatsToNearestDuration(blended);
  }

  _addToMeasure(pitch, beats) {
    const beatsPerMeasure = this._timeSig.num * (4 / this._timeSig.den);
    const remaining = beatsPerMeasure - this._accBeats;

    // Cap to remaining space in measure
    const actualBeats = Math.min(beats, remaining > 0 ? remaining : beats);
    const cappedBeats = beatsToNearestDuration(actualBeats);

    const note = this._makeNote(pitch, cappedBeats);

    this._accBeats += durationToBeats(note.duration);

    if (this._onNoteReady) this._onNoteReady(note);

    // Check if measure is full
    if (this._accBeats >= beatsPerMeasure - 0.01) {
      this._accBeats = 0;
      if (this._onMeasureFull) this._onMeasureFull();
    }

    return note;
  }

  _makeNote(pitch, beats) {
    const durationName = BEATS_TO_DURATION[beats] || 'quarter';
    return {
      id: generateUUID(),
      pitch,
      duration: durationName,
      dots: 0,
      accidental: null,
    };
  }

  // Auto-detect time signature from recent note durations
  detectTimeSignature() {
    if (this._recentDurations.length < 4) return null;

    const total = this._recentDurations.reduce((a, b) => a + b, 0);
    const avgBeat = total / this._recentDurations.length;

    // Try common groupings
    const candidates = [
      { num: 4, den: 4, bpMeasure: 4 },
      { num: 3, den: 4, bpMeasure: 3 },
      { num: 2, den: 4, bpMeasure: 2 },
      { num: 6, den: 8, bpMeasure: 3 },
      { num: 2, den: 2, bpMeasure: 2 },
    ];

    // Score each by how well durations fit
    let best = null;
    let bestScore = Infinity;
    for (const c of candidates) {
      let acc = 0, fills = 0, partials = 0;
      for (const d of this._recentDurations) {
        acc += d;
        if (Math.abs(acc % c.bpMeasure) < 0.1) fills++;
        else if (acc > c.bpMeasure) { partials++; acc = acc % c.bpMeasure; }
      }
      const score = partials - fills;
      if (score < bestScore) { bestScore = score; best = c; }
    }

    return best;
  }
}
