# Teleprompter — scope for a professional prompter

Rev 3 · 26 October 2026 · status: **approved; P1 in progress**. All §9
decisions settled by the owner on 26 October 2026. Device input (§5.7, P4)
and the phone remote are **on hold**: multi-monitor first.

The current site is one page: a settings rail next to a scrolling
`contenteditable` script. It works for reading a script off a laptop screen.
It is not a prompter you could run a shoot with: there's no separate display,
no operator, no live correction, and nothing is saved.

This document changes what the product is. **The page you open becomes a
control surface. What the talent reads is a separate, chrome-less output
window**, on another monitor, on teleprompter glass, or in the same window
with all UI hidden. The control surface sends the script and the scroll
position to every output and stays editable while the outputs are live.

---

## 1. Where the branding goes

The earlier note was that the Teleprompter "does not have the Carino UI". The
answer is that the product has two surfaces, and only one of them carries the
UI:

| Surface | Who sees it | Chrome |
|---|---|---|
| **Control** (`index.html`) | operator, or the talent before the take | Full fleet chrome: navbar, `carino-ui.css`, short hero, rail, i18n. Same rules as every other `tool` page. |
| **Output** (`output.html`) | talent, camera glass, audience | **None, by design.** Black field, script, reading line. No navbar, no cursor, no gold. Chrome on the output is a defect. |

So the output has no UI because that is the job, not because it is unfinished.
The control surface gets developed like any other fleet tool. `sites.json`
`type` stays `tool`. The output page is excluded from the sitemap and gets
`noindex`.

## 2. Review of what exists (rev at `867239a`)

What the rework must fix. Some of these are bugs today, not missing features.

| # | Finding | Why it matters |
|---|---|---|
| R1 | Speed is **pixels per frame** (`carry += speed * 0.5` once per rAF). | Scroll speed depends on the refresh rate: a 120 Hz monitor scrolls twice as fast as 60 Hz, and a dropped frame is a stutter. Speed has to be time-based. |
| R2 | Scrolling writes integer `scrollTop`. | At low speeds that is 0 px, then 1 px: visible judder. Pros read at low speeds. Move the text with `transform: translateY()` and sub-pixel values. |
| R3 | The display **is** the editor (`contenteditable`). | No separate text model, so you cannot render the script twice (control and output). Typing also does not re-apply `[cue]` colouring. |
| R4 | A paste **replaces the whole script**. | Pasting a correction in the middle of a take wipes the take. |
| R5 | The marker is a fixed triangle at 5 % / 40 %, and the text starts at a `40vh` pad. | The reading line is not something you can set, so the marker and the place the text "arrives" are two unrelated things. |
| R6 | Nothing persists. A reload loses the script. | Unacceptable once the tool is used on a shoot. |
| R7 | Only Space is bound. | Remotes, pedals and clickers send arrow, PgUp/PgDn and media keys. None of those do anything. |
| R8 | Mirror is horizontal only, and global. | Rigs need vertical flip too (some glass setups), and per output (the talent monitor is not mirrored, the glass is). |
| R9 | No fullscreen, no wake lock. | The screen sleeps during a long read. |
| R10 | Reaching the end stops silently. | The operator needs an end state they can see, and a way back. |
| R11 | `.md` is accepted but not interpreted. | Headings should become jump points (§5.4). |

Keep: the DOM-only rendering of `[cues]` (no `innerHTML`, so a script cannot
be markup), the privacy stance, the three fleet fonts, and the i18n
dictionaries (es, pt-BR, ja, ru).

## 3. Modes

The same engine runs in three arrangements. The user picks one with a single
choice on the control surface, not with settings spread over the page.
**The page opens in Present here** (decided §9.3): the sample script fills
the window with no chrome, and the HUD's "Controls" button (or Esc) opens the
control surface.

1. **Present here (one screen).** The control window turns into an output:
   fullscreen, all UI gone, cursor hidden. A thin HUD (position, timer, speed)
   appears on mouse move and fades after 2 s. Esc returns to control. This
   replaces today's page for the solo-creator case.
2. **Output window(s) (two or more screens).** "Open output" opens
   `output.html` as a popup. On Chromium with the Window Management API, the
   control lists the connected screens and opens the output fullscreen on the
   chosen one. Elsewhere the popup opens normally: drag it to the monitor and
   press **F** or double-click it, because fullscreen needs a user gesture in
   that window. You can open several outputs, for example glass and a
   confidence monitor.
3. **Operator + talent.** Mode 2, with a second person driving the control
   surface while the talent reads. Nothing extra is needed beyond mode 2.
   This is the case that makes live editing (§5.3) matter.

## 4. Architecture

### 4.1 Files

```
index.html          control surface (fleet chrome)
output.html         renderer only, no chrome
prompter/model.js   script text → blocks (paragraphs, cues, headings); pure, testable
prompter/render.js  blocks → DOM in a given output; layout + anchor⇄pixel mapping
prompter/motion.js  time-based scroll, speed ramps, the clock
prompter/link.js    BroadcastChannel protocol, output registry, reconnect
prompter/input.js   key/pedal/gamepad/MIDI → actions
prompter/player.js  the lead output's frame loop: motion ⇄ render bridge,
                    countdown, end state, transport, wake lock (added in P1)
```

Control and output share `model.js` and `render.js`, so what the operator
sees in the preview is exactly what the talent sees.

### 4.2 Position is an anchor, not pixels

Outputs differ in size, font size and mirroring, so a `scrollTop` from one
window means nothing in another. Position is **an anchor**: a character
offset into the script plus a fraction through the current line. Each output
converts the anchor to its own pixels and places that point on its own
reading line. This also lets one output use 140 px text and another use
60 px, with both showing the same words on the reading line.

### 4.3 Who owns the clock: the lead output

Browsers throttle `requestAnimationFrame` in hidden windows, and the operator
will alt-tab away from the control window. The output is the one window that
is always visible. So:

- One output is the **lead** (the first one opened, or the window itself in
  "Present here"). It runs the motion loop and broadcasts
  `{anchor, velocity, t}` about 20 times a second.
- Followers and the control preview **extrapolate** from the last message
  every frame, so motion stays smooth between messages, and snap gently
  (ease over about 150 ms) when a correction arrives.
- The control surface **sends commands** (play, pause, speed, jump, nudge).
  It never moves text itself.
- Time is `performance.timeOrigin + performance.now()`, which is comparable
  across windows. Each document's `performance.now()` alone is not.

**Speed unit:** line-heights per second on the lead output, displayed as an
approximate WPM. This is content-relative, so changing the text size does not
change the reading pace.

### 4.4 The link protocol

`BroadcastChannel('carino-teleprompter')`. It is same-origin and survives a
reload of either side. Messages are versioned, `{v:1, type, …}`:

| From → to | Message | Purpose |
|---|---|---|
| output → all | `hello {id, screen, w, h}` | announce, also after a reload |
| control → output | `script {rev, text}` | full text. Scripts are small (<200 KB), so no diffing on the wire |
| control → output | `settings {id \| '*', …}` | per-output or global settings |
| control → lead | `cmd {play, pause, speed, jump, nudge, ramp}` | transport |
| lead → all | `pos {anchor, velocity, t, rev}` | the clock |
| control → all | `ping` / output → `pong` | liveness. An output that loses its control for 3 s shows a small "control disconnected" dot and **keeps scrolling**: a crashed laptop tab must not freeze the talent mid-sentence |

A page loaded from `file://`, or a second copy on another origin, cannot join
the channel. That is fine, and §7 says so.

### 4.5 Persistence

`localStorage` holds the current script, settings and output layout (with
try/catch, and the page still works when it is unavailable). Up to 20 named
scripts are kept in IndexedDB for the rundown (§5.6). It is still **never
uploaded**. The privacy line becomes: "Saved in this browser only. Never
uploaded."

## 5. Features

### 5.1 Output display (per output)

- Mirror horizontal, flip vertical, or both. Set per output.
- Text size, line spacing, side margins (safe area), font (the three fleet
  fonts).
- **Text size can be set per output, but by default all outputs share one
  size** (decided §9.1). The control has one size slider while "same size on
  every output" is on, which is the default. Turning it off gives each output
  its own slider. The anchor model (§4.2) keeps the outputs on the same words
  either way.
- Reading line: position (0–100 % of height), drawn as a line, arrows on
  either side, or a band, or hidden. The text scrolls to the reading line;
  the line is not decoration.
- Colours: white on black by default, plus high-contrast and inverse
  presets. `[cues]` in a configurable colour (red stays the default). Cue
  colours must stay readable on both backgrounds.
- Optional dimming of text that has already passed the reading line.
- Fullscreen, cursor hidden, Screen Wake Lock held while playing.

### 5.2 Transport

- Play/pause, speed ±, reverse, nudge (a line up or down), jump back a
  paragraph.
- **Speed ramps**: starting and stopping ease over about 0.5 s, so speed
  never jumps.
- Countdown before start (off, 3, 5 or 10 s), shown on the outputs.
- End-of-script marker on the outputs, plus an explicit stopped state on the
  control.

### 5.3 Real-time editing (the operator feature)

- The control has a **plain-text editor** (a `<textarea>`, not
  `contenteditable`) next to the live preview. The editor is the source of
  truth.
- Edits are pushed as `script` messages, debounced to 300 ms.
- **The reading position survives the edit.** The anchor is mapped through
  the change (common prefix and suffix of the old and new text). Text that
  changed before the anchor shifts it, text after it does not. The talent's
  line must not jump when the operator fixes a typo two paragraphs ahead.
- **An edit inside the line currently being read takes effect immediately**
  (decided §9.2), like any other edit. The scroll position does not jump:
  the anchor stays at the start of the edited line, so the line is rewritten
  in place on the reading line. If the edit changes how many lines that
  paragraph wraps to, only the text below the reading line moves. No
  "apply later" queue and no confirmation step.
- The editor shows a "you are here" bar where the anchor is, so the operator
  edits ahead of the talent and not under them.
- Paste in the editor is a normal paste (fixes R4). "Replace script" is an
  explicit action: open file, drop file, or the paste button.

### 5.4 Navigation

- Script markup, kept small and plain-text:
  - `[cue]` → cue colour (existing)
  - `# Heading` → a jump point, shown smaller on outputs (or hidden, per
    setting)
  - a line holding only `---` → a hard stop: playback pauses there
- Jump list in the control (headings plus stops). Number keys 1–9 jump to
  the first nine.
- Click a paragraph in the preview or editor to jump the outputs there.

### 5.5 Timing

- Elapsed time, estimated remaining time at the current speed, and estimated
  total time, plus a target duration and how far ahead or behind you are.
- WPM readout. Before a take, "fit to N minutes" sets the speed.

### 5.6 Rundown

- Several saved scripts in order (segments of a show). Next/previous segment
  is one key. The current segment is pushed to the outputs.

### 5.7 Input devices — **on hold** (decided §9.5)

Only the fixed keyboard map ships (P1). Remapping, learn mode, gamepad, MIDI
and wheel wait until multi-monitor (P2, P3) is done.

All inputs map to the same actions through `input.js`, with a remappable
key table on the control (stored locally).

| Device | How it reaches the browser | Default |
|---|---|---|
| Keyboard | keydown | Space play/pause, ↑/↓ speed, ←/→ nudge, PgUp/PgDn paragraph, Home top, R reverse, F fullscreen, 1–9 jumps |
| Clicker / ring remote / foot pedal | almost all present as a **HID keyboard** (PgUp/PgDn, arrows, media keys) | covered by the key table, plus a "press your remote's button" learn mode |
| Mouse wheel on the output | wheel | scrub while paused, speed while playing |
| Gamepad | Gamepad API (polled in the lead's loop) | stick = speed, A = play/pause |
| MIDI controller | Web MIDI (Chromium, Firefox) | learn mode, mapped to actions |

Keys work in **both** the control and the output windows, because the
focused window is whichever one the operator last clicked.

## 6. Phasing

Each phase ships on its own and leaves the site usable.

| Phase | Contents | Done when |
|---|---|---|
| **P1 — Engine** | `model.js` / `render.js` / `motion.js`. Time-based, sub-pixel `translateY` motion (R1, R2). Settable reading line (R5). Textarea editor (R3, R4). Persistence (R6). Fixed keyboard map (R7). Fullscreen and wake lock (R9). End state (R10). **Present here** mode with the auto-hiding HUD. | Same pace at 60 and 144 Hz. A reload keeps the script. Present mode has no visible chrome. |
| **P2 — Outputs** | `output.html` and `link.js`. Open, reconnect and close outputs. Lead clock. Per-output settings, including mirror and flip (R8). Screen picker on Chromium, with a drag + F fallback. Live preview in the control. | Two outputs on two monitors stay on the same words to within one line through play, pause, speed changes and a control reload. |
| **P3 — Live editing** | Anchor mapping through edits. "You are here" bar. Edits on the current line rewrite it in place, with no jump. Markup (§5.4), jump list, countdown, timers (§5.5). | An edit ahead of the anchor never moves the talent's line. |
| **P4 — Devices** (on hold) | Learn mode, gamepad, Web MIDI, wheel. | A USB pedal and a Bluetooth ring work with no setup beyond learn mode. |
| **P5 — Rundown** | Multiple scripts, segment keys, import/export of a rundown as one `.txt` or `.json`. | — |

**Pulled forward into P1** (recorded 26 October 2026, so P2 and P3 start
from what exists):

- **Countdown** (P3 row). It runs only when playback starts from the top;
  resuming from a pause starts at once.
- **Vertical flip** (R8, P2 row) and **dimming of read text** (§5.1), as
  global settings. P2 makes mirror and flip per output.
- **Anchor mapping through edits** (P3 row), the basic form: common prefix
  and suffix, an insertion exactly at the anchor follows the text it pointed
  at, and an edit spanning the anchor lands at the start of the change. The
  in-line rewrite rule of §5.3 and the "you are here" bar are still P3.
- The "line" reading-line style is drawn as an underline below the line
  being read (so it never strikes through words) and is labelled
  "Underline".

Testing: `model.js` and the anchor mapping are pure functions and get
`node --test`, the way Ping does. The two-window sync gets a Playwright suite
(two pages, one context, BroadcastChannel). That is the same rig Topo and
Ping use.

i18n: every new control string goes through `i18n.js` in all four locales in
the same commit. The output has almost no text ("control disconnected", the
countdown, the end marker), and those are translated too.

## 7. Not in scope

- **No server, ever.** That rules out:
  - **a phone as a remote over the network**: two devices need a signalling
    server for WebRTC, and the fleet has no backend. Revisit only if a
    copy-paste or QR-code SDP exchange proves usable. Recorded as an open
    question, not a promise.
  - cloud sync of scripts, and accounts.
- **Voice-follow scrolling** (the prompter follows your speech). Chrome's Web
  Speech API sends audio to Google by default, which breaks "never
  uploaded". It is deferred until on-device recognition can be verified in
  the target browsers (Chrome's local-processing option, or a WASM model,
  which would be a heavy download). Research item, not a phase.
- Rich text (bold, sizes). Prompter scripts are plain text with cues, and
  rich text would bring back the `innerHTML` risk.
- `.docx` / `.rtf` import. Paste covers it. Revisit on demand.
- Hardware control protocols (serial prompter controllers). HID covers the
  real devices.
- Outputs on a different origin or from `file://` (§4.4). The Offline mirror
  works because it serves from one origin.

## 8. Browser support

| Feature | Chromium | Firefox | Safari |
|---|---|---|---|
| Output popups + BroadcastChannel | yes | yes | yes |
| Screen picker / fullscreen on a chosen screen (Window Management API) | yes (permission prompt) | no → drag + F | no → drag + F |
| Wake Lock | yes | yes | yes |
| Gamepad | yes | yes | yes |
| Web MIDI | yes | yes | no |

The minimum for a real shoot is two windows and keyboard input. Every
browser in the table can do that.

## 9. Open decisions

1. ~~Text size per output or global?~~ **Decided 2026-10-26:** an option
   per output, and by default every output uses the same size (§5.1).
2. ~~Edits on the current line: deferred or immediate?~~ **Decided
   2026-10-26:** they take effect immediately, rewriting the line in place
   (§5.3).
3. ~~Default first view?~~ **Decided 2026-10-26: Present here first.** The
   page opens as a prompter; the control surface is one click or Esc away.
   Fullscreen still needs a gesture, so the first view fills the window, and
   F or the HUD button makes it fullscreen.
4. ~~Rename "TelePrompter" → "Teleprompter"?~~ **Done 2026-10-26**: in
   `sites.json`, the hub's `tools.json`/`start.json` and the mark's label.
5. ~~Phone remote / devices?~~ **Decided 2026-10-26: on hold.** Multi-monitor
   only for now. P4 and the phone remote wait.
