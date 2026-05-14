import { pitchToVexKey, VEX_DURATION_MAP, needsAccidentalMark } from './utils.js';

// VexFlow 4 is loaded via CDN and sets window.Vex
function getVex() {
  return window.Vex?.Flow ?? null;
}

const MEASURES_PER_ROW = 4;
const ROW_HEIGHT = 160;
const STAVE_Y_OFFSET = 50;
const MARGIN_LEFT = 10;
const MARGIN_RIGHT = 10;
const EXTRA_FIRST_STAVE = 60; // space for clef/key/time on first stave

export class Renderer {
  constructor() {
    this.container = null;
    this._noteRefs = [];       // [{noteId, measureId, vfNote}]
    this._hitAreas = new Map();// noteId → SVG rect
    this._selectedId = null;
    this._svg = null;
  }

  init(containerEl) {
    this.container = containerEl;
    this.container.innerHTML = '';
  }

  render(session) {
    if (!this.container) return;
    const VF = getVex();
    if (!VF) { console.error('VexFlow not loaded'); return; }

    this.container.innerHTML = '';
    this._noteRefs = [];
    this._hitAreas.clear();

    const allMeasures = session.measures;
    if (!allMeasures || allMeasures.length === 0) return;

    const containerWidth = Math.max(600, this.container.clientWidth - 4);
    const numRows = Math.ceil(allMeasures.length / MEASURES_PER_ROW);
    const totalHeight = numRows * ROW_HEIGHT + 60;

    const renderer = new VF.Renderer(this.container, VF.Renderer.Backends.SVG);
    renderer.resize(containerWidth, totalHeight);
    const ctx = renderer.getContext();
    ctx.setFont('Arial', 10);
    ctx.setBackgroundFillStyle('transparent');

    let globalMeasIdx = 0;

    for (let rowIdx = 0; rowIdx < numRows; rowIdx++) {
      const rowMeasures = allMeasures.slice(rowIdx * MEASURES_PER_ROW, (rowIdx + 1) * MEASURES_PER_ROW);
      const rowY = rowIdx * ROW_HEIGHT + STAVE_Y_OFFSET;
      const totalAvail = containerWidth - MARGIN_LEFT - MARGIN_RIGHT;

      // Calculate widths: first stave gets extra space for clef/key/time symbols
      const isFirstRow = rowIdx === 0;
      const extraFirst = isFirstRow ? EXTRA_FIRST_STAVE : 30;
      const n = rowMeasures.length;
      const baseWidth = (totalAvail - (n > 1 ? extraFirst : 0)) / n;
      const firstWidth = baseWidth + (n > 1 ? extraFirst : 0);
      const otherWidth = baseWidth;

      let x = MARGIN_LEFT;

      for (let mi = 0; mi < rowMeasures.length; mi++) {
        const measure = rowMeasures[mi];
        const isFirstStave = mi === 0;
        const staveWidth = isFirstStave ? firstWidth : otherWidth;

        const stave = new VF.Stave(x, rowY, staveWidth);

        if (isFirstStave && rowIdx === 0) {
          stave.addClef(session.clef || 'treble');
          stave.addKeySignature(session.keySignature || 'C');
          stave.addTimeSignature(`${session.timeSignature.num}/${session.timeSignature.den}`);
        } else if (isFirstStave) {
          stave.addClef(session.clef || 'treble');
          stave.addKeySignature(session.keySignature || 'C');
        }

        stave.setContext(ctx).draw();

        // Build VexFlow notes for this measure
        const vfNotes = this._buildVFNotes(measure, session, VF);

        if (vfNotes.length > 0) {
          try {
            const voice = new VF.Voice({
              num_beats: session.timeSignature.num,
              beat_value: session.timeSignature.den,
            });
            voice.setMode(VF.Voice.Mode?.SOFT ?? 1);
            voice.addTickables(vfNotes);

            const formatter = new VF.Formatter();
            formatter.joinVoices([voice]).format([voice], staveWidth - 20);
            voice.draw(ctx, stave);

            // Auto-beam
            try {
              const beamableNotes = vfNotes.filter(n => !n.isRest?.() && ['8', '16', '32'].includes(n.getDuration?.()));
              if (beamableNotes.length > 0) {
                const beams = VF.Beam.generateBeams(beamableNotes);
                beams.forEach(b => b.setContext(ctx).draw());
              }
            } catch (_) { /* beaming is optional */ }

            // Store note refs for hit testing
            for (let ni = 0; ni < vfNotes.length; ni++) {
              const note = measure.notes[ni];
              if (note) {
                this._noteRefs.push({
                  noteId: note.id,
                  measureId: measure.id,
                  vfNote: vfNotes[ni],
                });
              }
            }
          } catch (e) {
            console.warn('VexFlow render error in measure', globalMeasIdx, e);
          }
        }

        x += staveWidth;
        globalMeasIdx++;
      }
    }

    this._svg = this.container.querySelector('svg');
    if (this._svg) {
      this._addHitAreas();
      if (this._selectedId) this.setSelectedNote(this._selectedId);
    }
  }

  _buildVFNotes(measure, session, VF) {
    const vfNotes = [];
    for (const note of measure.notes) {
      try {
        const vfNote = this._toVFNote(note, session, VF);
        vfNotes.push(vfNote);
      } catch (e) {
        console.warn('Failed to build note:', note, e);
        // Fallback: quarter rest
        try {
          vfNotes.push(new VF.StaveNote({ keys: ['b/4'], duration: 'qr' }));
        } catch (_) {}
      }
    }
    return vfNotes;
  }

  _toVFNote(note, session, VF) {
    const isRest = note.pitch === 'rest';
    const vexDur = VEX_DURATION_MAP[note.duration] || 'q';
    const dotted = note.dots > 0;

    if (isRest) {
      const durStr = vexDur + (dotted ? 'd' : '') + 'r';
      const n = new VF.StaveNote({ keys: ['b/4'], duration: durStr });
      return n;
    }

    const key = pitchToVexKey(note.pitch);
    const durStr = vexDur + (dotted ? 'd' : '');
    const n = new VF.StaveNote({ keys: [key], duration: durStr });

    // Accidentals
    const accMark = needsAccidentalMark(note, session.keySignature);
    if (accMark && VF.Accidental) {
      try { n.addModifier(new VF.Accidental(accMark), 0); } catch (_) {}
    }

    return n;
  }

  _addHitAreas() {
    if (!this._svg) return;

    for (const { noteId, vfNote } of this._noteRefs) {
      try {
        const x = vfNote.getAbsoluteX?.() ?? 0;
        const ys = vfNote.getYs?.() ?? [];
        if (ys.length === 0) continue;
        const y = ys[0];

        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x - 10);
        rect.setAttribute('y', y - 12);
        rect.setAttribute('width', 20);
        rect.setAttribute('height', 24);
        rect.setAttribute('rx', '3');
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('stroke', 'none');
        rect.setAttribute('class', 'note-hit-area');
        rect.dataset.noteId = noteId;
        rect.style.cursor = 'ns-resize';
        this._svg.appendChild(rect);
        this._hitAreas.set(noteId, rect);
      } catch (e) {
        // Skip if position not available
      }
    }
  }

  setSelectedNote(id) {
    this._selectedId = id;
    for (const [nid, rect] of this._hitAreas) {
      if (nid === id) {
        rect.setAttribute('fill', 'rgba(197, 168, 232, 0.45)');
        rect.setAttribute('stroke', '#c5a8e8');
        rect.setAttribute('stroke-width', '1.5');
      } else {
        rect.setAttribute('fill', 'transparent');
        rect.setAttribute('stroke', 'none');
      }
    }
  }

  clearSelection() {
    this._selectedId = null;
    for (const rect of this._hitAreas.values()) {
      rect.setAttribute('fill', 'transparent');
      rect.setAttribute('stroke', 'none');
    }
  }

  getNoteElementMap() {
    return new Map(this._hitAreas);
  }

  // Get the ordered list of note IDs for keyboard navigation
  getNoteOrder() {
    return this._noteRefs.map(r => r.noteId);
  }

  // Get bounding box of a note for positioning during drag preview
  getNotePosition(noteId) {
    const ref = this._noteRefs.find(r => r.noteId === noteId);
    if (!ref) return null;
    try {
      const x = ref.vfNote.getAbsoluteX?.() ?? 0;
      const ys = ref.vfNote.getYs?.() ?? [];
      return { x, y: ys[0] ?? 0 };
    } catch (_) { return null; }
  }
}
