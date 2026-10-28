# Teleprompter

A teleprompter that runs in the browser: write or paste your script, then read it as it scrolls past a reading line you can place.

**[Open it →](https://teleprompter.carino.systems/)** — runs in your browser, nothing to install, no account.

![The prompter in its Present view: large white script text on black, a red cue, reading-line arrows at both edges, and the thin control bar at the bottom](screenshot.webp)

## What it does

- **It opens as the prompter.** The script fills the window with nothing else on screen. Moving the mouse or tapping shows a thin bar (position, elapsed time, speed, Play, Full screen, Controls) that fades after two seconds, and the cursor hides with it. Press F or the bar's Full screen button for full screen.
- **Esc or Controls opens the control surface**: the editor, a live preview and the settings. **Present** goes back to the prompter. In full screen, the Esc that leaves full screen also opens the controls.
- The editor is a plain text box and the script is whatever is in it. Typing and pasting work as they do anywhere else, and the preview follows as you type without losing your place. To replace the whole script, open or drop a `.txt` or `.md` file.
- A blank line starts a new paragraph. Anything in [square brackets] is a cue: it is shown in red and not counted as spoken words. A line starting with `# ` is a heading: it shows smaller on the prompter (or not at all, if you choose) and becomes a jump point. A line of `---` is a stop: playback eases to a halt with it on the reading line, and Play carries on past it.
- **Live editing.** The editor shows where the reader is: the paragraph being read is tinted and the line on the reading line is highlighted. Editing ahead of that line never moves the text. Editing the line being read rewrites it in place, and only the text below it moves if the paragraph wraps differently. Editing above it keeps the same words on the reading line. While you are not typing in the editor, it scrolls itself to keep the reader's line in view.
- **Jumping.** The controls list the headings and stops. Click one, or press 1 to 9 for the first nine. Clicking a paragraph in the preview jumps there, and Ctrl+Enter (⌘+Enter) in the editor jumps to the paragraph at the cursor.
- **Timing.** Besides the elapsed time, the controls show about how long is left and how long the whole script takes at the current speed. Set a target length (for example 3:30) to see how far over or under it the take will end, and **Fit the speed** to set the speed that ends on it: from the top, the whole script; mid-take, what is left in the time that is left.
- Speed is in lines per second, with an approximate words-per-minute figure beside it, and it is the same on any screen refresh rate. Starting, stopping and speed changes ease in over half a second. When the script ends, the prompter stops and shows an end marker, and Play becomes "Back to top". Reverse stops at the top and turns forward again, so the next Play reads on.
- Settings: text size, line spacing, side margins, font (Red Hat Display, IBM Plex Sans, IBM Plex Mono), the reading line's height on the screen and its marker (arrows, an underline below the line being read, a band, or none), dimming of text already read, mirror left to right and flip upside down for teleprompter glass, and a 3, 5 or 10 second countdown when you start from the top (resuming from a pause starts at once). Changing the text size, font or margins keeps the same words on the reading line.
- Keys, in both views (not while you are typing in the editor or a text field; a focused checkbox keeps Space, a focused slider keeps its arrows):

  | Key | Does |
  | --- | --- |
  | Space | Play or pause |
  | ↑ / ↓ | Faster or slower |
  | ← / → | A line back or forward |
  | PgUp / PgDn | A paragraph back or forward |
  | Home | Back to the top |
  | R | Reverse |
  | 1 to 9 | Jump to a heading or stop |
  | F | Full screen |
  | Esc | Controls |

  Clickers and foot pedals that send these keys work too. The keys cannot be changed yet.
- The screen stays awake while the script is playing, in browsers that support it.
- **Other monitors.** When a second monitor is connected, the prompter offers to open there ("Open on the other screen"). In the controls, **Screens** lists your monitors by name (Chrome and Edge, after one permission prompt) and opens an output window on the one you pick. Opening one turns this window into the control surface. You can open several outputs, for example the teleprompter glass and a monitor for the talent. Each output has its own mirror and flip, and its own text size if you turn off "Same text size on every output". Editing the script updates every output as you type, without moving the reader's place. Keys work in any of the windows. In Firefox and Safari, open an output window, drag it to the other monitor and press F there.
- Output windows keep going on their own: if the control window is closed or reloaded, the text keeps moving (a small red dot shows the control is gone), and a reloaded control finds them again.

The script, your settings and your place in the script are saved in this browser only, so a reload brings them back. Nothing is uploaded. If the browser blocks storage (some private windows), the page still works but forgets on reload.

## Tests

`node --test tests/` runs the engine tests (script parsing, the time-based motion including a 60 Hz vs 144 Hz check, the frame loop and countdown, the key map, the position mapping, and the translations). `node tests/present.e2e.cjs` runs a headless Chromium pass over the page, `node tests/outputs.e2e.cjs` one over output windows on a simulated second monitor, and `node tests/p3.e2e.cjs` one over headings, stops, jumps, live edits and timing; it uses Playwright from the Topo repository's test folder, checked out next to this one (or set `PLAYWRIGHT=/path/to/playwright`).

## Licensing

**Mine — GNU Affero General Public License v3.0 or later.** Everything in this
repository *except* the paths listed below. Copyright © 2026 Miguel Carino.
Full terms in [LICENSE](LICENSE).

**Not mine.** The files below are third-party works redistributed here. This
project's licence does not cover them and could not: they are not mine to
relicense. Each keeps its own terms, and each carries its own notice.

| Path | What it is | Licence | Notice |
| --- | --- | --- | --- |
| [`fonts/`](fonts/) | IBM Plex Mono, IBM Plex Sans, Red Hat Display | SIL OFL 1.1 | [`fonts/OFL.txt`](fonts/OFL.txt) |

Those files travel with any fork, mirror or repackaging of this repository, and
their notices must travel with them.
