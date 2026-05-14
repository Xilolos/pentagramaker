# Pentagramaker

A browser-based sheet music transcription app. Sing, hum, or play an instrument into your microphone and watch sheet music appear in real time.

**Live app:** [xilolos.github.io/pentagramaker](https://xilolos.github.io/pentagramaker)

---

## Features

- **Real-time transcription** — pitch detection from microphone using the YIN algorithm
- **Note snap** — slider controls how aggressively pitch is rounded to the nearest semitone
- **Tempo snap** — slider controls how aggressively note durations snap to the BPM grid
- **MuseScore-like editor** — drag notes vertically to change pitch; full keyboard shortcut support
- **Session management** — create, rename, and browse multiple sheets; auto-saved locally
- **Piano playback** — play back your sheet with a synthesized triangle-wave piano
- **Metronome** — optional click track during recording
- **Transpose** — shift all notes up or down by semitones
- **Tempo shift** — change the BPM of an existing sheet
- **Export:** PDF (print), MusicXML (opens in MuseScore/Finale), MIDI
- **Share URL** — encode your sheet in a URL to share with others
- **Auto time signature detection** — detects 4/4, 3/4, 6/8, etc. from your playing
- Key signature, time signature, and clef selectors
- Minimal pastel UI — gets out of your way

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` / `↓` | Pitch ±1 semitone |
| `Shift+↑` / `Shift+↓` | Pitch ±1 octave |
| `←` / `→` | Navigate between notes |
| `Del` / `Backspace` | Delete note (replace with rest) |
| `1` – `6` | Set duration: whole → 32nd |
| `.` | Toggle dotted note |
| `R` | Convert to rest |
| `#` / `b` | Toggle sharp / flat |
| `Ctrl+Z` | Undo (20 steps) |

---

## How to Use

1. **Create a sheet** — a blank sheet is created automatically on first launch
2. **Set your tempo** — adjust BPM in the toolbar
3. **Click Rec** — a 3-2-1 countdown starts, then sing or play
4. **Watch the sheet fill** — notes appear live as you play
5. **Edit** — click any note to select it, then drag or use keyboard shortcuts
6. **Play back** — click ▶ Play to hear your melody
7. **Export** — download as PDF, MusicXML, or MIDI

---

## Tech Stack

- [VexFlow 4](https://www.vexflow.com/) — SVG sheet music rendering
- [Tone.js](https://tonejs.github.io/) — audio synthesis and playback scheduling
- Web Audio API — real-time microphone pitch detection (YIN algorithm)
- Vanilla ES modules — no build step, works directly in the browser
- localStorage — session persistence

---

## Local Development

No build step required. Just serve the files with any static server:

```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Or open index.html directly in a browser
# (some browsers restrict microphone access on file:// — use a server)
```

Then open `http://localhost:8080`.

---

## Browser Support

Chrome, Edge, and Firefox (latest). Safari is supported but microphone quality may vary due to WebKit's AudioContext implementation.

Requires HTTPS or localhost for microphone access.

---

## License

MIT
