import { generateUUID } from './utils.js';

const STORAGE_KEY = 'pentagramaker_sessions';
const ACTIVE_KEY = 'pentagramaker_active';

function defaultSession(name) {
  return {
    id: generateUUID(),
    name: name || 'New Sheet',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeSignature: { num: 4, den: 4 },
    keySignature: 'C',
    tempo: 120,
    clef: 'treble',
    measures: [{ id: generateUUID(), notes: [] }],
  };
}

let _sessions = [];
let _activeId = null;

function _flush() {
  try {
    const data = JSON.stringify(_sessions);
    if (data.length > 4 * 1024 * 1024) {
      console.warn('Pentagramaker: localStorage nearing 4MB limit');
    }
    localStorage.setItem(STORAGE_KEY, data);
    if (_activeId) localStorage.setItem(ACTIVE_KEY, _activeId);
  } catch (e) {
    console.error('Failed to save sessions:', e);
  }
}

export const SessionManager = {
  loadAll() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      _sessions = raw ? JSON.parse(raw) : [];
      _activeId = localStorage.getItem(ACTIVE_KEY);
    } catch (e) {
      _sessions = [];
      _activeId = null;
    }
    if (_sessions.length === 0) {
      const s = defaultSession('My First Sheet');
      _sessions.push(s);
      _activeId = s.id;
      _flush();
    }
    if (!_activeId || !_sessions.find(s => s.id === _activeId)) {
      _activeId = _sessions[0].id;
      _flush();
    }
    return _sessions;
  },

  getAll() {
    return _sessions;
  },

  getActive() {
    return _sessions.find(s => s.id === _activeId) ?? _sessions[0] ?? null;
  },

  setActive(id) {
    const s = _sessions.find(s => s.id === id);
    if (s) {
      _activeId = id;
      localStorage.setItem(ACTIVE_KEY, id);
    }
    return s ?? null;
  },

  create(name) {
    const s = defaultSession(name || `Sheet ${_sessions.length + 1}`);
    _sessions.unshift(s);
    _activeId = s.id;
    _flush();
    return s;
  },

  save(session) {
    session.updatedAt = new Date().toISOString();
    const idx = _sessions.findIndex(s => s.id === session.id);
    if (idx >= 0) {
      _sessions[idx] = session;
    } else {
      _sessions.unshift(session);
    }
    _flush();
  },

  delete(id) {
    _sessions = _sessions.filter(s => s.id !== id);
    if (_activeId === id) {
      _activeId = _sessions[0]?.id ?? null;
    }
    _flush();
    return _sessions.find(s => s.id === _activeId) ?? _sessions[0] ?? null;
  },

  rename(id, name) {
    const s = _sessions.find(s => s.id === id);
    if (s) {
      s.name = name;
      s.updatedAt = new Date().toISOString();
      _flush();
    }
  },

  exportJSON(session) {
    return JSON.stringify(session);
  },

  importJSON(str) {
    try {
      const s = JSON.parse(str);
      if (!s.id) s.id = generateUUID();
      s.name = (s.name || 'Imported') + ' (copy)';
      _sessions.unshift(s);
      _activeId = s.id;
      _flush();
      return s;
    } catch (e) {
      console.error('Import failed:', e);
      return null;
    }
  },

  // Get all notes in a flat array with measure index
  getAllNotes(session) {
    const result = [];
    for (const [mi, measure] of session.measures.entries()) {
      for (const [ni, note] of measure.notes.entries()) {
        result.push({ note, measureIndex: mi, noteIndex: ni });
      }
    }
    return result;
  },

  // Find note by id
  findNote(session, noteId) {
    for (const [mi, measure] of session.measures.entries()) {
      for (const [ni, note] of measure.notes.entries()) {
        if (note.id === noteId) return { note, measure, measureIndex: mi, noteIndex: ni };
      }
    }
    return null;
  },

  // Update a note in place
  updateNote(session, noteId, updates) {
    const found = this.findNote(session, noteId);
    if (found) {
      Object.assign(found.note, updates);
      this.save(session);
    }
  },

  // Delete a note and replace with rest
  deleteNote(session, noteId) {
    const found = this.findNote(session, noteId);
    if (!found) return;
    found.note.pitch = 'rest';
    found.note.accidental = null;
    this.save(session);
  },

  // Remove empty trailing measures, keep at least one
  pruneEmptyMeasures(session) {
    while (session.measures.length > 1) {
      const last = session.measures[session.measures.length - 1];
      if (last.notes.every(n => n.pitch === 'rest')) {
        session.measures.pop();
      } else {
        break;
      }
    }
    if (session.measures.length === 0) {
      session.measures.push({ id: generateUUID(), notes: [] });
    }
  },
};
