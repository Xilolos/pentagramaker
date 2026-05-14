import { pitchToMidi, durationToBeats } from './utils.js';

// Tone.js is loaded via CDN as window.Tone

let _synth = null;
let _metronome = null;
let _clickSynth = null;
let _isPlaying = false;
let _metronomeOn = false;
let _onNotePlay = null;
let _onStopped = null;

function getTone() {
  return window.Tone ?? null;
}

function ensureSynth() {
  const Tone = getTone();
  if (!Tone) throw new Error('Tone.js not loaded');
  if (!_synth) {
    _synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle8' },
      envelope: { attack: 0.02, decay: 0.4, sustain: 0.15, release: 1.5 },
      volume: -6,
    }).toDestination();
  }
  if (!_clickSynth) {
    _clickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.008,
      octaves: 2,
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -12,
    }).toDestination();
  }
}

export const Player = {
  onNotePlay(cb) { _onNotePlay = cb; },
  onStopped(cb) { _onStopped = cb; },

  isPlaying() { return _isPlaying; },

  setMetronome(on) {
    _metronomeOn = on;
    if (!on && _metronome) {
      _metronome.stop();
      _metronome.dispose();
      _metronome = null;
    }
  },

  async play(session) {
    const Tone = getTone();
    if (!Tone) { console.error('Tone.js not loaded'); return; }

    // Must call Tone.start() after user gesture
    await Tone.start();
    ensureSynth();

    if (_isPlaying) this.stop();

    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.bpm.value = session.tempo || 120;

    _isPlaying = true;

    // Flatten all notes into a timeline
    const timeline = [];
    let beatOffset = 0;
    const beatsPerMeasure = session.timeSignature.num * (4 / session.timeSignature.den);

    for (const measure of session.measures) {
      for (const note of measure.notes) {
        const beats = durationToBeats(note.duration) * (note.dots > 0 ? 1.5 : 1);
        timeline.push({ note, beatOffset });
        beatOffset += beats;
      }
    }

    if (timeline.length === 0) { _isPlaying = false; return; }

    const secPerBeat = 60 / (session.tempo || 120);

    for (const { note, beatOffset: bo } of timeline) {
      const startSec = bo * secPerBeat;
      const beats = durationToBeats(note.duration) * (note.dots > 0 ? 1.5 : 1);
      const durSec = beats * secPerBeat * 0.9; // slight staccato

      if (note.pitch !== 'rest') {
        const midi = pitchToMidi(note.pitch);
        if (midi !== null) {
          const freq = Tone.Frequency(midi, 'midi').toFrequency();
          Tone.Transport.schedule(time => {
            _synth.triggerAttackRelease(freq, durSec, time);
            if (_onNotePlay) Tone.getDraw()?.schedule(() => _onNotePlay(note.id), time);
          }, `+${startSec}`);
        }
      }
    }

    // Schedule stop
    const totalSec = beatOffset * secPerBeat;
    Tone.Transport.schedule(() => {
      Tone.getDraw()?.schedule(() => {
        _isPlaying = false;
        if (_onStopped) _onStopped();
      }, Tone.now());
    }, `+${totalSec + 0.2}`);

    // Metronome
    if (_metronomeOn) {
      _metronome = new Tone.Loop(time => {
        _clickSynth.triggerAttackRelease('C2', '16n', time);
      }, `${4 / session.timeSignature.den}n`);
      _metronome.start(0);
    }

    Tone.Transport.start(`+0.1`);
  },

  stop() {
    const Tone = getTone();
    if (!Tone) return;
    Tone.Transport.stop();
    Tone.Transport.cancel();
    _synth?.releaseAll?.();
    if (_metronome) {
      _metronome.stop();
      _metronome.dispose();
      _metronome = null;
    }
    _isPlaying = false;
    if (_onStopped) _onStopped();
  },

  // Preview a single note (for click feedback)
  async previewNote(pitch, duration = 'quarter') {
    const Tone = getTone();
    if (!Tone) return;
    await Tone.start();
    ensureSynth();
    const midi = pitchToMidi(pitch);
    if (midi === null) return;
    const freq = Tone.Frequency(midi, 'midi').toFrequency();
    _synth.triggerAttackRelease(freq, '8n');
  },
};
