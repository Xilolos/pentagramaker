import { pitchToMidi, midiToPitch, clampMidi, generateUUID } from './utils.js';

const PIXELS_PER_SEMITONE = 8;
const MAX_UNDO = 20;

export class Editor {
  constructor() {
    this._container = null;
    this._sessionManager = null;
    this._renderer = null;
    this._session = null;
    this._selectedNoteId = null;
    this._enabled = true;
    this._dragging = false;
    this._dragStartY = 0;
    this._dragStartMidi = 0;
    this._lastSemitoneDelta = 0;
    this._undoStack = [];
    this._onChanged = null;
  }

  init(containerEl, sessionManager, renderer) {
    this._container = containerEl;
    this._sessionManager = sessionManager;
    this._renderer = renderer;
    this._bindPointer();
    this._bindKeyboard();
  }

  setSession(session) {
    this._session = session;
    this._selectedNoteId = null;
  }

  onChanged(cb) { this._onChanged = cb; }
  enable() { this._enabled = true; }
  disable() { this._enabled = false; this._deselect(); }

  _bindPointer() {
    this._container.addEventListener('pointerdown', e => this._onPointerDown(e));
    this._container.addEventListener('pointermove', e => this._onPointerMove(e));
    this._container.addEventListener('pointerup', e => this._onPointerUp(e));
    this._container.addEventListener('pointercancel', e => this._onPointerUp(e));
  }

  _bindKeyboard() {
    document.addEventListener('keydown', e => this._onKeyDown(e));
  }

  _onPointerDown(e) {
    if (!this._enabled || !this._session) return;
    const el = e.target.closest('[data-note-id]');
    if (!el) {
      this._deselect();
      return;
    }

    const noteId = el.dataset.noteId;
    const found = this._sessionManager.findNote(this._session, noteId);
    if (!found || found.note.pitch === 'rest') {
      this._selectNote(noteId);
      return;
    }

    this._selectNote(noteId);
    this._dragging = true;
    this._dragStartY = e.clientY;
    this._dragStartMidi = pitchToMidi(found.note.pitch) ?? 60;
    this._lastSemitoneDelta = 0;
    this._container.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  _onPointerMove(e) {
    if (!this._dragging || !this._session) return;
    const deltaY = this._dragStartY - e.clientY; // up = positive
    const semitoneDelta = Math.round(deltaY / PIXELS_PER_SEMITONE);

    if (semitoneDelta !== this._lastSemitoneDelta) {
      this._lastSemitoneDelta = semitoneDelta;
      const newMidi = clampMidi(this._dragStartMidi + semitoneDelta);
      const newPitch = midiToPitch(newMidi);
      // Live update in model
      const found = this._sessionManager.findNote(this._session, this._selectedNoteId);
      if (found) {
        found.note.pitch = newPitch;
        found.note.accidental = newPitch.includes('#') ? '#' : null;
        this._renderer.render(this._session);
        this._renderer.setSelectedNote(this._selectedNoteId);
      }
    }
  }

  _onPointerUp(e) {
    if (!this._dragging) return;
    this._dragging = false;
    this._container.releasePointerCapture?.(e.pointerId);
    if (this._session) {
      this._pushUndo();
      this._sessionManager.save(this._session);
      this._notify();
    }
  }

  _onKeyDown(e) {
    if (!this._enabled || !this._session || !this._selectedNoteId) return;
    const found = this._sessionManager.findNote(this._session, this._selectedNoteId);
    if (!found) return;

    const note = found.note;
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA';
    if (isInput) return;

    let handled = true;

    switch (e.key) {
      case 'ArrowUp': {
        const shift = e.shiftKey ? 12 : 1;
        if (note.pitch !== 'rest') {
          const midi = clampMidi((pitchToMidi(note.pitch) ?? 60) + shift);
          note.pitch = midiToPitch(midi);
          note.accidental = note.pitch.includes('#') ? '#' : null;
          this._commit();
        }
        break;
      }
      case 'ArrowDown': {
        const shift = e.shiftKey ? 12 : 1;
        if (note.pitch !== 'rest') {
          const midi = clampMidi((pitchToMidi(note.pitch) ?? 60) - shift);
          note.pitch = midiToPitch(midi);
          note.accidental = note.pitch.includes('#') ? '#' : null;
          this._commit();
        }
        break;
      }
      case 'ArrowLeft':
        this._navigateNote(-1);
        break;
      case 'ArrowRight':
        this._navigateNote(1);
        break;
      case 'Delete':
      case 'Backspace':
        this._pushUndo();
        note.pitch = 'rest';
        note.accidental = null;
        this._commit();
        break;
      case '1': this._setDuration('whole'); break;
      case '2': this._setDuration('half'); break;
      case '3': this._setDuration('quarter'); break;
      case '4': this._setDuration('eighth'); break;
      case '5': this._setDuration('sixteenth'); break;
      case '6': this._setDuration('32nd'); break;
      case '.': note.dots = note.dots > 0 ? 0 : 1; this._commit(); break;
      case 'r': case 'R':
        note.pitch = 'rest';
        note.accidental = null;
        this._commit();
        break;
      case '#':
        if (note.pitch !== 'rest') {
          const base = note.pitch.replace(/[#b]/g, '');
          note.pitch = base.includes('#') ? base : base.replace(/([A-G])/, '$1#');
          note.accidental = '#';
          this._commit();
        }
        break;
      case 'b':
        if (note.pitch !== 'rest') {
          // toggle flat
          const m = pitchToMidi(note.pitch);
          if (m !== null) {
            const enharmonic = midiToPitch(m - 1);
            // We want to express as flatted version
            const base = note.pitch.replace(/[#b]/g, '');
            note.pitch = enharmonic;
            note.accidental = 'b';
            this._commit();
          }
        }
        break;
      case 'z':
      case 'Z':
        if (e.ctrlKey || e.metaKey) { this._undo(); }
        else handled = false;
        break;
      default:
        handled = false;
    }

    if (handled) e.preventDefault();
  }

  _setDuration(dur) {
    const found = this._sessionManager.findNote(this._session, this._selectedNoteId);
    if (found) {
      this._pushUndo();
      found.note.duration = dur;
      this._commit();
    }
  }

  _navigateNote(dir) {
    const order = this._renderer.getNoteOrder();
    const idx = order.indexOf(this._selectedNoteId);
    if (idx === -1) return;
    const newIdx = idx + dir;
    if (newIdx >= 0 && newIdx < order.length) {
      this._selectNote(order[newIdx]);
    }
  }

  _selectNote(id) {
    this._selectedNoteId = id;
    this._renderer.setSelectedNote(id);
  }

  _deselect() {
    this._selectedNoteId = null;
    this._renderer.clearSelection?.();
  }

  _commit() {
    this._sessionManager.save(this._session);
    this._renderer.render(this._session);
    this._renderer.setSelectedNote(this._selectedNoteId);
    this._notify();
  }

  _notify() {
    if (this._onChanged) this._onChanged(this._session);
  }

  _pushUndo() {
    this._undoStack.push(JSON.stringify(this._session));
    if (this._undoStack.length > MAX_UNDO) this._undoStack.shift();
  }

  _undo() {
    if (this._undoStack.length === 0) return;
    const prev = JSON.parse(this._undoStack.pop());
    Object.assign(this._session, prev);
    this._sessionManager.save(this._session);
    this._renderer.render(this._session);
    this._notify();
  }

  getSelectedNoteId() { return this._selectedNoteId; }
}
