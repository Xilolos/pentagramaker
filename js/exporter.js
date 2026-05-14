import { pitchToMidi, durationToBeats, VEX_DURATION_MAP } from './utils.js';

// ─── MusicXML ────────────────────────────────────────────────────────────────

function pitchToXML(pitch) {
  if (!pitch || pitch === 'rest') return null;
  const match = pitch.match(/^([A-G])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return null;
  const [, step, acc, octStr] = match;
  const alter = acc.split('').reduce((s, c) => s + (c === '#' ? 1 : -1), 0);
  return { step, alter, octave: parseInt(octStr) };
}

function durationToXMLType(duration) {
  const map = { whole: 'whole', half: 'half', quarter: 'quarter', eighth: 'eighth', sixteenth: '16th', '32nd': '32nd' };
  return map[duration] || 'quarter';
}

function durationToXMLDivisions(duration, divisions = 4) {
  // divisions = ticks per quarter note
  const beats = durationToBeats(duration);
  return Math.round(beats * divisions);
}

export function exportMusicXML(session) {
  const divisions = 8; // ticks per quarter
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${escXML(session.name)}</work-title></work>
  <part-list>
    <score-part id="P1"><part-name>${escXML(session.name)}</part-name></score-part>
  </part-list>
  <part id="P1">
`;

  for (const [mi, measure] of session.measures.entries()) {
    xml += `    <measure number="${mi + 1}">\n`;

    if (mi === 0) {
      xml += `      <attributes>
        <divisions>${divisions}</divisions>
        <key><fifths>${keyToFifths(session.keySignature)}</fifths><mode>major</mode></key>
        <time><beats>${session.timeSignature.num}</beats><beat-type>${session.timeSignature.den}</beat-type></time>
        <clef><sign>${session.clef === 'bass' ? 'F' : 'G'}</sign><line>${session.clef === 'bass' ? '4' : '2'}</line></clef>
      </attributes>
      <direction placement="above">
        <direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${session.tempo}</per-minute></metronome></direction-type>
        <sound tempo="${session.tempo}"/>
      </direction>\n`;
    }

    for (const note of measure.notes) {
      const isRest = note.pitch === 'rest';
      const dur = durationToXMLDivisions(note.duration, divisions);
      const type = durationToXMLType(note.duration);
      const dot = note.dots > 0 ? '\n        <dot/>' : '';

      if (isRest) {
        xml += `      <note><rest/><duration>${dur}</duration><type>${type}</type>${dot}</note>\n`;
      } else {
        const p = pitchToXML(note.pitch);
        if (!p) continue;
        const alterEl = p.alter !== 0 ? `\n          <alter>${p.alter}</alter>` : '';
        const accEl = (note.accidental && note.accidental !== 'n')
          ? `\n        <accidental>${note.accidental === '#' ? 'sharp' : note.accidental === 'b' ? 'flat' : 'natural'}</accidental>`
          : '';
        xml += `      <note>
        <pitch>
          <step>${p.step}</step>${alterEl}
          <octave>${p.octave}</octave>
        </pitch>
        <duration>${dur}</duration>
        <type>${type}</type>${dot}${accEl}
      </note>\n`;
      }
    }
    xml += `    </measure>\n`;
  }

  xml += `  </part>\n</score-partwise>`;

  download(xml, `${sanitizeFilename(session.name)}.musicxml`, 'application/vnd.recordare.musicxml+xml');
}

function keyToFifths(key) {
  const map = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6 };
  return map[key] ?? 0;
}

function escXML(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── MIDI ─────────────────────────────────────────────────────────────────────

function toVLQ(value) {
  const bytes = [];
  bytes.push(value & 0x7F);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7F) | 0x80);
    value >>= 7;
  }
  return bytes;
}

function writeUint32(val) {
  return [(val >> 24) & 0xFF, (val >> 16) & 0xFF, (val >> 8) & 0xFF, val & 0xFF];
}

function writeUint16(val) {
  return [(val >> 8) & 0xFF, val & 0xFF];
}

export function exportMIDI(session) {
  const ticksPerBeat = 480;
  const tempo = session.tempo || 120;
  const microsecondsPerBeat = Math.round(60_000_000 / tempo);

  const trackEvents = [];

  // Tempo event
  trackEvents.push(
    ...toVLQ(0), 0xFF, 0x51, 0x03,
    (microsecondsPerBeat >> 16) & 0xFF,
    (microsecondsPerBeat >> 8) & 0xFF,
    microsecondsPerBeat & 0xFF,
  );

  // Time signature event
  trackEvents.push(
    ...toVLQ(0), 0xFF, 0x58, 0x04,
    session.timeSignature.num,
    Math.log2(session.timeSignature.den),
    24, 8,
  );

  // Notes
  for (const measure of session.measures) {
    for (const note of measure.notes) {
      const beats = durationToBeats(note.duration) * (note.dots > 0 ? 1.5 : 1);
      const ticks = Math.round(beats * ticksPerBeat);

      if (note.pitch === 'rest') {
        // Just advance time — represented by note-off delay on a silent channel
        trackEvents.push(...toVLQ(ticks), 0x80, 60, 0);
        trackEvents.push(...toVLQ(0), 0x90, 60, 0);
      } else {
        const midi = pitchToMidi(note.pitch) ?? 60;
        const velocity = 80;
        // Note on
        trackEvents.push(...toVLQ(0), 0x90, midi, velocity);
        // Note off after duration
        trackEvents.push(...toVLQ(ticks), 0x80, midi, 0);
      }
    }
  }

  // End of track
  trackEvents.push(...toVLQ(0), 0xFF, 0x2F, 0x00);

  // Build file
  const header = [
    0x4D, 0x54, 0x68, 0x64, // MThd
    ...writeUint32(6),       // header length
    ...writeUint16(0),       // format 0
    ...writeUint16(1),       // 1 track
    ...writeUint16(ticksPerBeat),
  ];

  const trackLen = trackEvents.length;
  const track = [
    0x4D, 0x54, 0x72, 0x6B, // MTrk
    ...writeUint32(trackLen),
    ...trackEvents,
  ];

  const bytes = new Uint8Array([...header, ...track]);
  downloadBinary(bytes, `${sanitizeFilename(session.name)}.mid`, 'audio/midi');
}

// ─── PDF ──────────────────────────────────────────────────────────────────────

export function exportPDF() {
  window.print();
}

// ─── Share URL ────────────────────────────────────────────────────────────────

export function getShareableURL(session) {
  try {
    const json = JSON.stringify(session);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const url = new URL(window.location.href);
    url.hash = `s=${b64}`;
    return url.toString();
  } catch (e) {
    console.error('Share URL failed:', e);
    return null;
  }
}

export function loadFromURL() {
  try {
    const hash = window.location.hash;
    if (!hash.startsWith('#s=')) return null;
    const b64 = hash.slice(3);
    const json = decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function download(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function downloadBinary(bytes, filename, mimeType) {
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(name) {
  return (name || 'sheet').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'sheet';
}
