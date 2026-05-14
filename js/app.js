import { SessionManager } from './session-manager.js';
import { PitchDetector } from './pitch-detector.js';
import { Quantizer } from './quantizer.js';
import { Renderer } from './renderer.js';
import { Editor } from './editor.js';
import { Player } from './player.js';
import { exportMusicXML, exportMIDI, exportPDF, exportSessionJSON, getShareableURL, loadFromURL } from './exporter.js';
import { generateUUID, pitchToMidi, midiToPitch, clampMidi } from './utils.js';

// ─── State ────────────────────────────────────────────────────────────────────

let session = null;
let recording = false;
let countdownTimer = null;
let pendingNoteStart = null;
let lastSilenceStart = null;

const pitchDetector = new PitchDetector();
const quantizer = new Quantizer();
const renderer = new Renderer();
const editor = new Editor();

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);

const elSheetContainer = $('sheet-container');
const elSidebar = $('session-list');
const elSessionName = $('session-name');
const elBtnNew = $('btn-new');
const elBtnRename = $('btn-rename');
const elBtnShare = $('btn-share');
const elBtnRec = $('btn-rec');
const elBtnPlay = $('btn-play');
const elBtnStop = $('btn-stop');
const elBtnMetro = $('btn-metro');
const elBpmInput = $('bpm-input');
const elNoteSnap = $('note-snap');
const elTempoSnap = $('tempo-snap');
const elKeySelect = $('key-select');
const elTimeSelect = $('time-select');
const elClefSelect = $('clef-select');
const elBtnTranspose = $('btn-transpose');
const elBtnTempoShift = $('btn-tempo-shift');
const elBtnDownload = $('btn-download');
const elDownloadMenu = $('download-menu');
const elBtnPDF = $('btn-pdf');
const elBtnMXL = $('btn-mxl');
const elBtnMIDI = $('btn-midi');
const elBtnJSON = $('btn-json');
const elSidebarPanel = $('sidebar');
const elSettingsPanel = $('settings');
const elBtnSidebarToggle = $('btn-sidebar-toggle');
const elBtnSettingsToggle = $('btn-settings-toggle');
const elMobileOverlay = $('mobile-overlay');
const elImportFileInput = $('import-file-input');
const elCountdown = $('countdown');
const elRecStatus = $('rec-status');
const elTransposeModal = $('transpose-modal');
const elTempoModal = $('tempo-modal');
const elTransposeInput = $('transpose-semitones');
const elTempoInput = $('tempo-new-bpm');
const elBtnTransposeApply = $('btn-transpose-apply');
const elBtnTransposeClose = $('btn-transpose-close');
const elBtnTempoApply = $('btn-tempo-apply');
const elBtnTempoClose = $('btn-tempo-close');

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Check for shared session in URL
  const shared = loadFromURL();
  if (shared) {
    SessionManager.loadAll();
    session = SessionManager.importJSON(JSON.stringify(shared));
    window.location.hash = ''; // clear hash
  } else {
    SessionManager.loadAll();
    session = SessionManager.getActive();
  }

  renderer.init(elSheetContainer);
  editor.init(elSheetContainer, SessionManager, renderer);
  editor.setSession(session);
  editor.onChanged(s => { session = s; renderSidebar(); });

  renderSidebar();
  renderSession();
  syncControls();

  bindToolbar();
  bindSettings();
  bindModals();

  // Debounced render during recording — accumulates rapid notes (e.g. 8th notes)
  // into a single render call so VexFlow draws them with proper beaming.
  let _renderTimer = null;
  function scheduleRender() {
    clearTimeout(_renderTimer);
    _renderTimer = setTimeout(() => renderer.render(session), 120);
  }

  // Pitch detector callbacks
  pitchDetector.onNote(noteInfo => {
    if (!recording) return;
    // If a previous note was active and pitch changed (no silence gap), end it first
    if (pendingNoteStart && pendingNoteStart.pitch !== noteInfo.pitch) {
      quantizer.endNote({
        pitch: pendingNoteStart.pitch,
        startTime: pendingNoteStart.startTime,
        endTime: noteInfo.startTime,
      });
    }
    quantizer.beginNote(noteInfo.pitch, noteInfo.startTime);
    pendingNoteStart = noteInfo;
    elRecStatus.textContent = `♩ ${noteInfo.pitch}`;
  });

  pitchDetector.onSilence(silenceInfo => {
    if (!recording) return;
    if (pendingNoteStart) {
      quantizer.endNote({
        pitch: silenceInfo.pitch || pendingNoteStart.pitch,
        startTime: pendingNoteStart.startTime,
        endTime: silenceInfo.endTime,
      });
      pendingNoteStart = null;
      elRecStatus.textContent = 'Listening…';
    }
  });

  quantizer.onNoteReady(note => {
    if (!session) return;
    const lastMeasure = session.measures[session.measures.length - 1];
    lastMeasure.notes.push(note);
    SessionManager.save(session);
    scheduleRender(); // debounced — batches rapid 8th notes into one render
  });

  quantizer.onMeasureFull(() => {
    if (!session) return;
    session.measures.push({ id: generateUUID(), notes: [] });
    SessionManager.save(session);
    // Render immediately on measure boundary so user sees the barline
    clearTimeout(_renderTimer);
    renderer.render(session);
  });

  // Handle window resize
  window.addEventListener('resize', debounce(() => renderer.render(session), 200));
}

// ─── Rendering ────────────────────────────────────────────────────────────────

function renderSession() {
  if (!session) return;
  renderer.render(session);
  editor.setSession(session);
}

function renderSidebar() {
  const sessions = SessionManager.getAll();
  elSidebar.innerHTML = '';
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = 'session-item' + (s.id === session?.id ? ' active' : '');
    li.dataset.id = s.id;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'session-item-name';
    nameSpan.textContent = s.name;

    const delBtn = document.createElement('button');
    delBtn.className = 'session-delete';
    delBtn.innerHTML = '×';
    delBtn.title = 'Delete sheet';
    delBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (confirm(`Delete "${s.name}"?`)) {
        session = SessionManager.delete(s.id) ?? session;
        renderSidebar();
        renderSession();
        syncControls();
      }
    });

    li.appendChild(nameSpan);
    li.appendChild(delBtn);
    li.addEventListener('click', () => {
      if (recording) return;
      session = SessionManager.setActive(s.id);
      renderSidebar();
      renderSession();
      syncControls();
    });

    elSidebar.appendChild(li);
  }

  if (session) {
    elSessionName.textContent = session.name;
  }
}

function syncControls() {
  if (!session) return;
  elBpmInput.value = session.tempo;
  elKeySelect.value = session.keySignature;
  elTimeSelect.value = `${session.timeSignature.num}/${session.timeSignature.den}`;
  elClefSelect.value = session.clef;
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

function bindToolbar() {
  elBtnNew.addEventListener('click', () => {
    session = SessionManager.create();
    editor.setSession(session);
    renderSidebar();
    renderSession();
    syncControls();
  });

  elBtnRename.addEventListener('click', () => {
    const name = prompt('Sheet name:', session?.name || '');
    if (name && name.trim() && session) {
      SessionManager.rename(session.id, name.trim());
      session.name = name.trim();
      renderSidebar();
    }
  });

  elBtnShare.addEventListener('click', () => {
    const url = getShareableURL(session);
    if (!url) { alert('Could not generate share URL.'); return; }
    navigator.clipboard.writeText(url).then(() => {
      showToast('Link copied to clipboard!');
    }).catch(() => {
      prompt('Copy this URL:', url);
    });
  });

  elBtnRec.addEventListener('click', () => {
    if (recording) { stopRecording(); return; }
    startCountdown();
  });

  elBtnPlay.addEventListener('click', async () => {
    if (Player.isPlaying()) { Player.stop(); return; }
    if (!session) return;
    setPlaybackState(true);
    Player.onStopped(() => setPlaybackState(false));
    await Player.play(session);
  });

  elBtnStop.addEventListener('click', () => {
    if (recording) stopRecording();
    if (Player.isPlaying()) Player.stop();
    setPlaybackState(false);
    setRecordingState(false);
  });

  elBtnMetro.addEventListener('click', () => {
    const on = elBtnMetro.classList.toggle('active');
    Player.setMetronome(on);
    elBtnMetro.title = on ? 'Metronome on' : 'Metronome off';
  });

  elBpmInput.addEventListener('change', () => {
    const bpm = parseInt(elBpmInput.value);
    if (!isNaN(bpm) && bpm > 0 && session) {
      session.tempo = bpm;
      quantizer.setTempo(bpm);
      SessionManager.save(session);
    }
  });

  elNoteSnap.addEventListener('input', () => {
    const pct = parseInt(elNoteSnap.value) / 100;
    pitchDetector.setNoteSnap(pct);
    $('note-snap-label').textContent = `${elNoteSnap.value}%`;
  });

  elTempoSnap.addEventListener('input', () => {
    const pct = parseInt(elTempoSnap.value) / 100;
    quantizer.setTempoSnap(pct);
    $('tempo-snap-label').textContent = `${elTempoSnap.value}%`;
  });

  // Download dropdown
  elBtnDownload.addEventListener('click', e => {
    e.stopPropagation();
    elDownloadMenu.classList.toggle('open');
  });

  const closeDownloadMenu = () => elDownloadMenu.classList.remove('open');

  elBtnPDF.addEventListener('click', () => { exportPDF(); closeDownloadMenu(); });
  elBtnMXL.addEventListener('click', () => { session && exportMusicXML(session); closeDownloadMenu(); });
  elBtnMIDI.addEventListener('click', () => { session && exportMIDI(session); closeDownloadMenu(); });
  elBtnJSON.addEventListener('click', () => { session && exportSessionJSON(session); closeDownloadMenu(); });

  document.addEventListener('click', closeDownloadMenu);

  // Import session file
  elImportFileInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const imported = SessionManager.importJSON(ev.target.result);
      if (imported) {
        session = imported;
        editor.setSession(session);
        renderSidebar();
        renderSession();
        syncControls();
        showToast(`Imported "${imported.name}"`);
      } else {
        showToast('Import failed: invalid file', 'error');
      }
      elImportFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // Mobile panel toggles
  function closeMobilePanels() {
    elSidebarPanel.classList.remove('mobile-open');
    elSettingsPanel.classList.remove('mobile-open');
    elMobileOverlay.classList.remove('active');
  }

  elBtnSidebarToggle.addEventListener('click', () => {
    const opening = !elSidebarPanel.classList.contains('mobile-open');
    closeMobilePanels();
    if (opening) {
      elSidebarPanel.classList.add('mobile-open');
      elMobileOverlay.classList.add('active');
    }
  });

  elBtnSettingsToggle.addEventListener('click', () => {
    const opening = !elSettingsPanel.classList.contains('mobile-open');
    closeMobilePanels();
    if (opening) {
      elSettingsPanel.classList.add('mobile-open');
      elMobileOverlay.classList.add('active');
    }
  });

  elMobileOverlay.addEventListener('click', closeMobilePanels);
}

// ─── Settings panel ───────────────────────────────────────────────────────────

function bindSettings() {
  elKeySelect.addEventListener('change', () => {
    if (!session) return;
    session.keySignature = elKeySelect.value;
    SessionManager.save(session);
    renderer.render(session);
  });

  elTimeSelect.addEventListener('change', () => {
    if (!session) return;
    const [num, den] = elTimeSelect.value.split('/').map(Number);
    session.timeSignature = { num, den };
    quantizer.setTimeSignature(num, den);
    SessionManager.save(session);
    renderer.render(session);
  });

  elClefSelect.addEventListener('change', () => {
    if (!session) return;
    session.clef = elClefSelect.value;
    SessionManager.save(session);
    renderer.render(session);
  });
}

// ─── Modals ───────────────────────────────────────────────────────────────────

function bindModals() {
  elBtnTranspose.addEventListener('click', () => {
    elTransposeInput.value = '0';
    elTransposeModal.classList.add('open');
  });

  elBtnTransposeClose.addEventListener('click', () => elTransposeModal.classList.remove('open'));

  elBtnTransposeApply.addEventListener('click', () => {
    const semitones = parseInt(elTransposeInput.value);
    if (!isNaN(semitones) && semitones !== 0 && session) {
      transposeSession(session, semitones);
      SessionManager.save(session);
      renderer.render(session);
    }
    elTransposeModal.classList.remove('open');
  });

  elBtnTempoShift.addEventListener('click', () => {
    elTempoInput.value = session?.tempo ?? 120;
    elTempoModal.classList.add('open');
  });

  elBtnTempoClose.addEventListener('click', () => elTempoModal.classList.remove('open'));

  elBtnTempoApply.addEventListener('click', () => {
    const newBpm = parseInt(elTempoInput.value);
    if (!isNaN(newBpm) && newBpm > 0 && session) {
      session.tempo = newBpm;
      quantizer.setTempo(newBpm);
      elBpmInput.value = newBpm;
      SessionManager.save(session);
    }
    elTempoModal.classList.remove('open');
  });

  // Close modals on backdrop click
  [elTransposeModal, elTempoModal].forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) modal.classList.remove('open');
    });
  });
}

// ─── Recording ────────────────────────────────────────────────────────────────

function startCountdown() {
  let count = 3;
  elCountdown.textContent = count;
  elCountdown.classList.add('visible');

  countdownTimer = setInterval(() => {
    count--;
    if (count > 0) {
      elCountdown.textContent = count;
    } else {
      clearInterval(countdownTimer);
      elCountdown.classList.remove('visible');
      beginRecording();
    }
  }, 1000);
}

async function beginRecording() {
  try {
    quantizer.reset();
    quantizer.setTempo(session?.tempo ?? 120);
    quantizer.setTempoSnap(parseInt(elTempoSnap.value) / 100);
    quantizer.setTimeSignature(session?.timeSignature.num ?? 4, session?.timeSignature.den ?? 4);
    pitchDetector.setNoteSnap(parseInt(elNoteSnap.value) / 100);
    await pitchDetector.start();
    recording = true;
    setRecordingState(true);
    elRecStatus.textContent = 'Listening...';
  } catch (e) {
    console.error('Recording failed:', e);
    showToast('Microphone error: ' + e.message, 'error');
    setRecordingState(false);
  }
}

function stopRecording() {
  if (countdownTimer) { clearInterval(countdownTimer); elCountdown.classList.remove('visible'); }
  recording = false;
  pitchDetector.stop();
  pendingNoteStart = null;
  setRecordingState(false);
  elRecStatus.textContent = '';

  // Auto-detect time signature
  const detected = quantizer.detectTimeSignature();
  if (detected && session) {
    const current = `${session.timeSignature.num}/${session.timeSignature.den}`;
    const det = `${detected.num}/${detected.den}`;
    if (current !== det) {
      session.timeSignature = { num: detected.num, den: detected.den };
      elTimeSelect.value = det;
      SessionManager.save(session);
      renderer.render(session);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setRecordingState(on) {
  document.body.classList.toggle('recording', on);
  elBtnRec.textContent = on ? '⏹ Stop Rec' : '● Rec';
  elBtnRec.classList.toggle('active', on);
  if (on) {
    editor.disable();
  } else {
    editor.enable();
  }
}

function setPlaybackState(on) {
  document.body.classList.toggle('playing', on);
  elBtnPlay.textContent = on ? '⏸ Pause' : '▶ Play';
  elBtnPlay.classList.toggle('active', on);
}

function transposeSession(sess, semitones) {
  for (const measure of sess.measures) {
    for (const note of measure.notes) {
      if (note.pitch !== 'rest') {
        const midi = pitchToMidi(note.pitch);
        if (midi !== null) {
          note.pitch = midiToPitch(clampMidi(midi + semitones));
          note.accidental = note.pitch.includes('#') ? '#' : null;
        }
      }
    }
  }
}

function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('visible'));
  setTimeout(() => {
    t.classList.remove('visible');
    setTimeout(() => t.remove(), 400);
  }, 2500);
}

function debounce(fn, ms) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
