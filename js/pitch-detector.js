import { hzToMidi, midiToHz, midiToPitch, nearestSemitoneHz } from './utils.js';

// More permissive threshold catches quieter/shorter notes at the cost of occasional noise
const YIN_THRESHOLD = 0.15;
// Lower silence threshold so soft singing isn't treated as silence
const SILENCE_RMS = 0.007;
// 2 frames × 30ms = 60ms minimum stable duration — catches shorter notes
const STABLE_FRAMES = 2;
const POLL_MS = 30;
const FREQ_MIN = 60;   // ~B1, below bass voice range
const FREQ_MAX = 2100; // ~C7, well above soprano range

function yinDetect(buffer, sampleRate) {
  const halfSize = Math.floor(buffer.length / 2);

  // RMS check
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
  const rms = Math.sqrt(sum / buffer.length);
  if (rms < SILENCE_RMS) return null;

  // YIN difference function + CMND (Cumulative Mean Normalized Difference)
  const yin = new Float32Array(halfSize);
  yin[0] = 1;
  let runningSum = 0;

  for (let tau = 1; tau < halfSize; tau++) {
    let diff = 0;
    for (let j = 0; j < halfSize; j++) {
      const d = buffer[j] - buffer[j + tau];
      diff += d * d;
    }
    runningSum += diff;
    yin[tau] = runningSum > 0 ? diff * tau / runningSum : 1;
  }

  // Find first tau where CMND drops below threshold, then walk to local minimum
  let tau = -1;
  for (let t = 2; t < halfSize - 1; t++) {
    if (yin[t] < YIN_THRESHOLD) {
      // Walk forward to the bottom of this valley
      while (t + 1 < halfSize - 1 && yin[t + 1] < yin[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau === -1) return null;

  // Octave error correction — YIN frequently detects one octave too low.
  // If the half-period (= double frequency) is ALSO a strong pitch candidate,
  // prefer it. This fixes the most common source of "pitch too low" reports.
  const halfTau = Math.round(tau / 2);
  if (halfTau >= 2 && halfTau < halfSize) {
    // Half-tau CMND is comparable in quality → prefer the higher octave
    if (yin[halfTau] < yin[tau] * 1.2 && yin[halfTau] < YIN_THRESHOLD * 2) {
      tau = halfTau;
    }
  }

  // Parabolic interpolation for sub-sample accuracy
  let tauRef = tau;
  if (tau > 0 && tau < halfSize - 1) {
    const s0 = yin[tau - 1], s1 = yin[tau], s2 = yin[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-10) tauRef = tau + (s2 - s0) / denom;
  }

  const hz = sampleRate / tauRef;
  return (hz >= FREQ_MIN && hz <= FREQ_MAX) ? hz : null;
}

export class PitchDetector {
  constructor() {
    this._audioCtx = null;
    this._analyser = null;
    this._stream = null;
    this._pollTimer = null;
    this._buffer = null;
    this._noteSnapPct = 1.0;
    this._onNote = null;
    this._onSilence = null;
    this._currentMidi = null;
    this._stableCount = 0;
    this._noteActive = false;
    this._noteStartTime = null;
    this._noteHz = null;
    // Pitch smoothing — track last N detected midis to reject outliers
    this._pitchHistory = [];
  }

  setNoteSnap(pct) { this._noteSnapPct = Math.max(0, Math.min(1, pct)); }
  onNote(cb) { this._onNote = cb; }
  onSilence(cb) { this._onSilence = cb; }

  async start() {
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
    } catch (e) {
      throw new Error('Microphone access denied: ' + e.message);
    }

    this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = this._audioCtx.createMediaStreamSource(this._stream);
    this._analyser = this._audioCtx.createAnalyser();
    // Larger buffer = better low-frequency resolution (e.g. bass voice at 80 Hz)
    this._analyser.fftSize = 4096;
    source.connect(this._analyser);
    this._buffer = new Float32Array(this._analyser.fftSize);

    this._currentMidi = null;
    this._stableCount = 0;
    this._noteActive = false;
    this._noteStartTime = null;
    this._pitchHistory = [];

    this._pollTimer = setInterval(() => this._poll(), POLL_MS);
  }

  stop() {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._noteActive && this._onSilence) {
      this._onSilence({
        pitch: midiToPitch(this._currentMidi),
        midi: this._currentMidi,
        hz: this._noteHz,
        startTime: this._noteStartTime,
        endTime: Date.now(),
      });
    }
    this._noteActive = false;
    this._currentMidi = null;
    this._stableCount = 0;
    this._pitchHistory = [];

    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this._audioCtx) {
      this._audioCtx.close();
      this._audioCtx = null;
    }
  }

  _poll() {
    if (!this._analyser) return;
    this._analyser.getFloatTimeDomainData(this._buffer);
    const sampleRate = this._audioCtx.sampleRate;
    const rawHz = yinDetect(this._buffer, sampleRate);

    if (rawHz === null) {
      this._handleSilence();
      return;
    }

    // Apply note snap (blend raw pitch toward nearest semitone)
    const snappedHz = rawHz * (1 - this._noteSnapPct) + nearestSemitoneHz(rawHz) * this._noteSnapPct;
    const midi = hzToMidi(snappedHz);

    // Outlier rejection: if this midi jumps more than 2 semitones from recent
    // history AND history is consistent, treat as noise
    if (this._pitchHistory.length >= 3) {
      const recent = this._pitchHistory.slice(-3);
      const allSame = recent.every(m => m === recent[0]);
      if (allSame && Math.abs(midi - recent[0]) > 2) {
        return; // likely a glitch frame — skip
      }
    }

    // Update pitch history
    this._pitchHistory.push(midi);
    if (this._pitchHistory.length > 6) this._pitchHistory.shift();

    if (midi === this._currentMidi) {
      this._stableCount++;
      if (this._stableCount === STABLE_FRAMES && !this._noteActive) {
        // Confirmed note onset
        this._noteActive = true;
        this._noteStartTime = Date.now() - (STABLE_FRAMES * POLL_MS); // backdate to true onset
        this._noteHz = snappedHz;
        if (this._onNote) {
          this._onNote({ pitch: midiToPitch(midi), midi, hz: snappedHz, startTime: this._noteStartTime });
        }
      }
    } else {
      // Pitch changed — end previous note
      if (this._noteActive) {
        const endTime = Date.now();
        if (this._onSilence) {
          this._onSilence({
            pitch: midiToPitch(this._currentMidi),
            midi: this._currentMidi,
            hz: this._noteHz,
            startTime: this._noteStartTime,
            endTime,
          });
        }
        this._noteActive = false;
      }
      this._currentMidi = midi;
      this._stableCount = 1;
    }
  }

  _handleSilence() {
    this._pitchHistory = [];
    if (this._noteActive) {
      const endTime = Date.now();
      if (this._onSilence) {
        this._onSilence({
          pitch: midiToPitch(this._currentMidi),
          midi: this._currentMidi,
          hz: this._noteHz,
          startTime: this._noteStartTime,
          endTime,
        });
      }
      this._noteActive = false;
    }
    this._currentMidi = null;
    this._stableCount = 0;
    this._noteStartTime = null;
  }
}
