/* prompter/app.js — index.html: the control surface and "Present here".

   The page opens as a prompter (Present here): #screen fills the window,
   the fleet chrome is hidden, and a thin HUD shows on mouse or touch and
   fades after 2 s. Esc or the HUD's Controls button switches to the
   control surface, where #screen moves into the preview frame (scaled to
   fit), so the preview is literally the output the reader sees.

   The textarea is the source of truth. Edits re-render the output and
   keep the reading position (an anchor, see render.js). The frame loop,
   transport and countdown live in player.js and the key map in input.js,
   so a P2 output.html reuses them as they are; this file is only the
   control wiring. Script, settings and position live in localStorage
   only, behind try/catch. */
(function () {
    'use strict';
    var TP = window.TP;
    var tt = function (k) { return typeof window.t === 'function' ? window.t(k) : k; };
    var $ = function (id) { return document.getElementById(id); };
    function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

    // The sample, as a script. Same string as SAMPLE_EN in i18n.js (the key).
    var SAMPLE = 'Sample script.\n\n'
        + 'This is the prompter. Press [Space] to start scrolling and again to pause. The up and down arrows change the speed, and the left and right arrows move one line.\n\n'
        + 'Words in [brackets] are cues for you, shown in red. Keep your eyes near the reading line and let the text come to you.\n\n'
        + 'Press [Esc] or Controls to open the editor. Type or paste your own script there. It is saved in this browser and never uploaded.\n\n'
        + 'Press [F] for full screen. This tool is [free] and [open source].';

    // ---- storage: this browser only, and the page works without it ----
    var KEY_SCRIPT = 'teleprompter:script', KEY_SETTINGS = 'teleprompter:settings', KEY_POS = 'teleprompter:pos';
    function load(k) { try { var v = window.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
    function save(k, v) { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode, quota, blocked */ } }

    // ---- settings ----
    var RANGE = {
        speed: { min: 0.1, max: 3, step: 0.01, def: 0.6 },   // the keys step 0.05; "fit" needs finer
        size: { min: 24, max: 300, step: 2, def: Math.round(clamp(window.innerWidth / 12, 40, 160) / 2) * 2 },
        spacing: { min: 1, max: 2, step: 0.05, def: 1.25 },
        margin: { min: 0, max: 30, step: 1, def: 8 },
        linePos: { min: 0, max: 100, step: 1, def: 40 },
    };
    var CHOICE = {
        font: ['display', 'sans', 'mono'],
        lineStyle: ['arrows', 'line', 'band', 'hidden'],
        countdown: ['0', '3', '5', '10'],
        headings: ['small', 'hidden'],
    };
    var FLAGS = ['dim', 'mirror', 'flip'];
    function snap(k, v) {
        var r = RANGE[k];
        v = +v;
        if (!isFinite(v)) return r.def;
        v = clamp(Math.round((v - r.min) / r.step) * r.step + r.min, r.min, r.max);
        return +v.toFixed(2);
    }
    function loadSettings() {
        var got = load(KEY_SETTINGS) || {}, s = {};
        Object.keys(RANGE).forEach(function (k) { s[k] = got[k] == null ? RANGE[k].def : snap(k, got[k]); });
        Object.keys(CHOICE).forEach(function (k) { s[k] = CHOICE[k].indexOf(String(got[k])) >= 0 ? String(got[k]) : CHOICE[k][0]; });
        FLAGS.forEach(function (k) { s[k] = got[k] === true; });
        s.sameSize = got.sameSize !== false;   // one text size on every output, unless asked
        s.target = +got.target > 0 && +got.target < 360000 ? Math.round(+got.target) : 0;   // seconds; 0 = none
        return s;
    }
    var settings = loadSettings();
    function renderSettings() {
        return {
            size: settings.size, spacing: settings.spacing, margin: settings.margin, font: settings.font,
            mirror: settings.mirror, flip: settings.flip, linePos: settings.linePos, lineStyle: settings.lineStyle, dim: settings.dim,
            headings: settings.headings,
        };
    }

    // ---- engine: one renderer (the output), its motion, the frame loop ----
    var screen = $('screen'), frame = $('frame'), hud = $('hud'), editor = $('editor');
    // the "you are here" bar behind the editor (P3)
    var here = TP.here.create(editor, $('edBack'), { mapOffset: TP.model.mapOffset });
    var motion = TP.motion.create({ speed: settings.speed });
    var model = TP.model.parse('');
    var isSample = true;
    var player = null;
    var station = null;
    var renderer = TP.render.create(screen, { onLayout: function (y) { if (station) station.layout(y); } });
    var wake = TP.player.wakeLock(navigator, document);
    // P2: other windows (output.html) join over the channel; null when the
    // browser has none, and the page is then a single window as in P1.
    var link = TP.link.open('control', onLinkMessage);
    player = TP.player.create({
        motion: motion, renderer: renderer,
        onChange: function () { station.changed(); updateUi(); },
        onFrame: updateReadouts,
        onIdle: savePos,
        onTick: function () { station.tick(); },
    });
    // This window leads (runs the scroll) until an output window opens;
    // then the first output leads and this one follows it (§4.3).
    station = TP.station.create({
        renderer: renderer, motion: motion, player: player, link: link,
        onStatus: function () { updateUi(); },
    });
    player.setCountdown(+settings.countdown);

    // A transport action, run where the scroll is driven: here, or in the
    // lead output window.
    function act(action, arg) {
        if (station.isLead()) TP.station.perform(player, action, arg);
        else if (link) link.send({ type: 'cmd', to: leadId, action: action, arg: arg });
    }

    function changeSpeed(d) {
        settings.speed = snap('speed', settings.speed + d);
        $('speed').value = settings.speed;
        setSpeed();
        saveSettings(); updateUi();
    }

    // ---- fullscreen (R9) ----
    // The browser keeps Esc for leaving fullscreen, so the page never sees
    // that keydown: an exit the page did not ask for is taken as that Esc
    // and opens the controls (§3: Esc returns to control).
    function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    var fsWas = false, fsExitAsked = false;
    function exitFs() {
        var ex = document.exitFullscreen || document.webkitExitFullscreen;
        if (ex && fsElement()) {
            fsExitAsked = true;
            try { var p = ex.call(document); if (p && p.catch) p.catch(function () {}); } catch (e) { /* not allowed */ }
        }
    }
    function toggleFullscreen() {
        if (fsElement()) return exitFs();
        if (mode !== 'present') setMode('present');
        var el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) { try { var p = req.call(el); if (p && p.catch) p.catch(function () {}); } catch (e) { /* no gesture, or refused */ } }
    }
    function updateFsLabel() { setLabel($('hudFs'), fsElement() ? 'Exit full screen' : 'Full screen'); }
    function onFsChange() {
        var on = !!fsElement();
        if (fsWas && !on && !fsExitAsked && mode === 'present' && document.visibilityState === 'visible') setMode('control');
        fsWas = on; fsExitAsked = false;
        updateFsLabel();
    }
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    document.addEventListener('visibilitychange', function () {
        player.resetClock();
        if (document.visibilityState === 'hidden') { saveScript(); savePos(); }
    });

    // ---- modes ----
    var mode = 'present';
    function setMode(m) {
        mode = m;
        var present = m === 'present';
        document.body.classList.toggle('present', present);
        if (present) {
            document.body.insertBefore(screen, hud);
            screen.style.width = screen.style.height = screen.style.transform = '';
            if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
            poke();
        } else {
            exitFs();
            frame.appendChild(screen);
            clearTimeout(idleTimer);
            hud.classList.remove('show');
            document.body.classList.remove('idle');
            fitPreview();
            window.dispatchEvent(new Event('resize'));   // the navbar refits
        }
        applyOwnSettings();
        renderer.check();
        if (!present) { here.refresh(); updateHere(); }
    }
    // The preview is the output at the window's size, scaled into the frame.
    function fitPreview() {
        if (mode !== 'control') return;
        // the lead output's size when there is one: the preview is that screen
        var o = previewOutput(), W = o && o.w ? o.w : window.innerWidth, H = o && o.h ? o.h : window.innerHeight;
        frame.style.setProperty('--ar', (W / H).toFixed(4));
        var k = frame.getBoundingClientRect().width / W;
        screen.style.width = W + 'px';
        screen.style.height = H + 'px';
        screen.style.transform = 'scale(' + k + ')';
    }
    window.addEventListener('resize', fitPreview);
    if (typeof ResizeObserver === 'function') new ResizeObserver(fitPreview).observe(frame);

    // ---- HUD: shows on input, fades after 2 s; the cursor hides with it ----
    var idleTimer = 0;
    function poke(ms) {
        if (mode !== 'present') return;
        hud.classList.add('show');
        document.body.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(goIdle, ms || 2000);
    }
    function goIdle() {
        if (hud.matches(':hover') || hud.contains(document.activeElement)) { idleTimer = setTimeout(goIdle, 2000); return; }
        hud.classList.remove('show');
        document.body.classList.add('idle');
    }
    document.addEventListener('pointermove', function (e) { if (e.movementX || e.movementY || e.pointerType !== 'mouse') poke(); });
    document.addEventListener('pointerdown', function () { poke(); });
    screen.addEventListener('dblclick', function () {
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
        if (mode === 'present') toggleFullscreen();
    });

    // ---- readouts ----
    function lang() { return (window.CarinoLang && window.CarinoLang.current) || 'en'; }
    function num(v, digits) {
        try { return new Intl.NumberFormat(lang(), { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v); }
        catch (e) { return v.toFixed(digits); }
    }
    function clock(sec) {
        sec = Math.floor(sec);
        var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function setSpeed() {
        motion.setSpeed(settings.speed);
        act('speed', settings.speed);
        pushSettings();
    }
    function speedText() {
        // words over the scroll distance (gaps between paragraphs included)
        var w = TP.motion.wpm(settings.speed, renderer.words(), Math.max(1, motion.max));
        return num(settings.speed, 2) + ' ' + tt('lines/s') + ' · ≈ ' + w + ' ' + tt('WPM');
    }
    function setLabel(el, key) { el.dataset.i18nKey = key; el.textContent = tt(key); }
    // Timing (§5.5), in the lead's own line units: what is left at the
    // current speed, the whole script at that speed, and against a target
    // the finish projected from the time so far plus what is left.
    function timing(st) {
        var sp = st.speed || settings.speed, sl = st.sl || 0;
        var left = sl * (1 - st.progress) / sp, total = sl / sp;
        return { left: left, total: total, off: settings.target ? st.elapsed + left - settings.target : null };
    }
    function updateReadouts() {
        var st = station.status(), tm = timing(st);
        var pos = Math.round(st.progress * 100) + ' %', time = clock(st.elapsed), sp = speedText();
        $('hudPos').textContent = pos; $('ctlPos').textContent = pos;
        $('hudTime').textContent = time; $('ctlTime').textContent = time;
        $('hudLeft').textContent = '−' + clock(tm.left);
        $('ctlLeft').textContent = tt('≈ {t} left').replace('{t}', clock(tm.left));
        $('ctlTotal').textContent = tt('≈ {t} in all').replace('{t}', clock(tm.total));
        var tg = $('ctlTarget');
        if (tm.off == null) { tg.textContent = ''; tg.removeAttribute('data-off'); }
        else if (Math.abs(tm.off) < 2) { tg.textContent = tt('On target'); tg.dataset.off = 'on'; }
        else {
            tg.dataset.off = tm.off > 0 ? 'over' : 'under';
            tg.textContent = (tm.off > 0 ? tt('{t} over target') : tt('{t} under target')).replace('{t}', clock(Math.abs(tm.off)));
        }
        $('hudSpeed').textContent = sp; $('ctlSpeed').textContent = sp;
        $('speedVal').textContent = sp;
        $('hudPos').title = tt('Position'); $('hudTime').title = tt('Elapsed'); $('hudSpeed').title = tt('Speed');
        $('hudLeft').title = tt('Remaining'); $('ctlLeft').title = tt('Remaining');
        updateHere();
    }
    // the editor's bar, and the jump list's current entry
    function updateHere() {
        if (mode !== 'control' || !marks) return;
        here.set(renderer.reading(), model.text);
        var a = renderer.anchor().offset, cur = -1;
        for (var i = 0; i < marks.length; i++) if (marks[i].offset <= a) cur = i;
        if (cur !== jumpCur) {
            jumpCur = cur;
            var bs = $('jumps').children;
            for (i = 0; i < bs.length; i++) bs[i].setAttribute('aria-current', i === cur ? 'true' : 'false');
        }
    }
    function updateUi() {
        var st = station.status(), run = st.running, end = st.ended, countdown = st.countdown;
        wake.set(run && (st.lead || mode === 'present'));
        var key = run ? 'Pause' : end ? 'Back to top' : 'Play';
        ['playBtn', 'playBtn2', 'hudPlay'].forEach(function (id) {
            var b = $(id);
            setLabel(b, key);
            b.setAttribute('aria-pressed', run ? 'true' : 'false');
        });
        $('revBtn').setAttribute('aria-pressed', st.dir < 0 ? 'true' : 'false');
        var state = countdown ? 'countdown' : st.playing ? 'playing' : end ? 'ended' : st.stop ? 'stop' : 'paused';
        var stEl = $('ctlState');
        stEl.dataset.state = state;
        stEl.textContent = tt({ countdown: 'Countdown', playing: st.dir < 0 ? 'Playing in reverse' : 'Playing', ended: 'End of script', stop: 'At a stop', paused: 'Paused' }[state]);
        updateReadouts();
    }
    function updateOutputs() {
        $('sizeVal').textContent = settings.size + ' px';
        $('spacingVal').textContent = num(settings.spacing, 2) + '×';
        $('marginVal').textContent = settings.margin + ' %';
        $('linePosVal').textContent = settings.linePos + ' %';
    }

    // ---- script in: the editor, a file, a drop ----
    var saveTimer = 0, renderTimer = 0;
    function saveScript() { clearTimeout(saveTimer); save(KEY_SCRIPT, isSample ? { sample: true } : { text: editor.value }); }
    function saveSettings() { save(KEY_SETTINGS, settings); }
    // The sample's text depends on the language, so its position is saved
    // language-neutral: paragraph, how far through it, frac. A script of
    // your own is saved as the anchor plus the text length it belongs to.
    function savePos() {
        save(KEY_POS, isSample ? { sample: sampleSpot(renderer.anchor()) } : { anchor: renderer.anchor(), len: model.text.length });
    }
    function sampleSpot(a) {
        var B = model.blocks, i = TP.model.blockIndexAt(B, a.offset);
        if (i < 0) return null;
        if (motion.ended) return { para: B.length - 1, rel: 1, frac: 0.5 };   // stays on the last line
        var b = B[i], rel = a.offset <= b.start ? 0 : (a.offset - b.start) / Math.max(1, b.end - b.start);
        return { para: i, rel: clamp(rel, 0, 1), frac: a.frac };
    }
    function fromSampleSpot(m, n) {
        if (!n || !isFinite(n.para) || !isFinite(n.rel) || !isFinite(n.frac) || !m.blocks.length) return null;
        var b = m.blocks[clamp(Math.round(n.para), 0, m.blocks.length - 1)];
        return { offset: b.start + Math.round(clamp(n.rel, 0, 1) * (b.end - b.start)), frac: clamp(+n.frac, -1, 2) };
    }

    // An edit: re-render, carrying the reader through the change (an edit
    // on the line being read rewrites it in place, render.js).
    function applyEditor() {
        clearTimeout(renderTimer);
        var text = editor.value;
        if (text === model.text) return;
        var next = TP.model.parse(text), c = TP.model.carry(model, next, renderer.anchor());
        model = next;
        renderer.setModel(model, c.anchor, c.edit);
        sendScript();
        renderJumps();
        updateUi();
    }
    editor.addEventListener('input', function () {
        isSample = false;
        clearTimeout(renderTimer); renderTimer = setTimeout(applyEditor, 150);
        clearTimeout(saveTimer); saveTimer = setTimeout(saveScript, 400);
    });

    // Replacing is explicit (open or drop a file); a paste is a normal paste.
    function replaceScript(text, sample) {
        text = String(text).replace(/\r\n?/g, '\n');
        isSample = !!sample;
        editor.value = text;
        model = TP.model.parse(text);
        renderer.setModel(model);
        sendScript(true);
        act('top');
        saveScript();
        renderJumps();
    }
    var note = function (msg) { $('fileNote').textContent = msg || ''; };
    function isTextFile(f) {
        return !f.type || /^text\//.test(f.type) || /\.(txt|md|markdown|text)$/i.test(f.name || '');
    }
    function readFile(file) {
        if (!file) return;
        note('');
        if (!isTextFile(file)) return note(tt('Only plain-text files (.txt, .md) can be opened.'));
        if (file.size > 5 * 1024 * 1024) return note(tt('That file is too large for a script.'));
        file.text().then(function (text) {
            replaceScript(text);
            note(tt('Replaced with {name}.').replace('{name}', file.name));
        }, function () { note(tt('Could not read that file.')); });
    }
    var zone = $('dropZone'), fileIn = $('fileInput');
    // a mouse click must not leave the zone focused, or Space reopens the picker
    zone.addEventListener('click', function (e) { fileIn.click(); if (e.detail && zone.blur) zone.blur(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
    fileIn.addEventListener('change', function () { readFile(fileIn.files[0]); fileIn.value = ''; });
    function hasFiles(e) {
        var ty = e.dataTransfer && e.dataTransfer.types;
        if (!ty) return false;
        for (var i = 0; i < ty.length; i++) if (ty[i] === 'Files') return true;
        return false;
    }
    // Only file drags are taken over; dragging text into the editor stays normal.
    document.addEventListener('dragover', function (e) { if (!hasFiles(e)) return; e.preventDefault(); zone.classList.add('dragover'); });
    document.addEventListener('dragleave', function (e) { if (!e.relatedTarget) zone.classList.remove('dragover'); });
    document.addEventListener('drop', function (e) {
        zone.classList.remove('dragover');
        if (!hasFiles(e)) return;
        e.preventDefault();
        readFile(e.dataTransfer.files[0]);
    });

    // ---- settings controls ----
    Object.keys(RANGE).forEach(function (k) {
        var inp = $(k);
        inp.value = settings[k];
        inp.addEventListener('input', function () {
            settings[k] = snap(k, inp.value);
            if (k === 'speed') setSpeed();
            else { applyOwnSettings(); pushSettings(); }
            updateOutputs(); updateReadouts(); saveSettings();
        });
    });
    Object.keys(CHOICE).forEach(function (k) {
        var sel = $(k);
        sel.value = settings[k];
        sel.addEventListener('change', function () {
            settings[k] = CHOICE[k].indexOf(sel.value) >= 0 ? sel.value : CHOICE[k][0];
            if (k === 'countdown') player.setCountdown(+settings.countdown);
            else applyOwnSettings();
            if (k === 'headings') updateHere();
            pushSettings();
            updateReadouts(); saveSettings();
        });
    });
    FLAGS.forEach(function (k) {
        var cb = $(k);
        cb.checked = settings[k];
        cb.addEventListener('change', function () {
            settings[k] = cb.checked;
            applyOwnSettings();
            saveSettings();
        });
    });

    // ---- buttons and fields: a mouse click gives focus back to the page,
    // so Space keeps meaning play/pause; keyboard use keeps focus ----
    function onClick(id, fn) {
        var b = $(id);
        b.addEventListener('click', function (e) { fn(); if (e.detail && b.blur) b.blur(); });
    }
    var toggle = function () { act('toggle'); };
    onClick('playBtn', toggle); onClick('playBtn2', toggle); onClick('hudPlay', toggle);
    onClick('presentBtn', function () { setMode('present'); });
    onClick('hudCtl', function () { setMode('control'); });
    onClick('hudFs', toggleFullscreen);
    onClick('topBtn', function () { act('top'); });
    onClick('prevBtn', function () { act('paragraph', -1); });
    onClick('nextBtn', function () { act('paragraph', 1); });
    onClick('revBtn', function () { act('reverse'); });
    onClick('hudOut', offerOutputs);

    // ---- jumps (P3, §5.4): headings and stops, keys 1–9, a click in the
    // preview, Ctrl+Enter in the editor ----
    var marks = [], jumpCur = -2, jumpsKey = '';
    function jump(offset) { act('jump', offset); poke(); }
    // what follows a stop says which one it is: a heading, or first words
    function stopLabel(mk, next) {
        var b = model.blocks[mk.block + 1], words = '';
        if (next && next.kind === 'heading' && next.block === mk.block + 1) words = next.label;
        else if (b && b.kind === 'text') {
            words = model.text.slice(b.start, b.end).replace(/\s+/g, ' ');
            if (words.length > 48) words = words.slice(0, 48).replace(/\s\S*$/, '') + ' …';
        }
        return tt('Stop') + (words ? ' · ' + words : '');
    }
    function renderJumps() {
        marks = TP.model.marks(model);
        var labels = marks.map(function (mk, i) { return mk.kind === 'stop' ? stopLabel(mk, marks[i + 1]) : mk.label; });
        var key = marks.map(function (mk, i) { return mk.offset + ':' + labels[i]; }).join('\n') + lang();
        if (key === jumpsKey) return;
        jumpsKey = key;
        var box = $('jumps');
        box.textContent = '';
        marks.forEach(function (mk, i) {
            var b = el('button', 'tp-jump');
            b.type = 'button';
            b.dataset.kind = mk.kind;
            if (mk.level) b.dataset.level = mk.level;
            b.appendChild(el('span', 'tp-jump-k', i < 9 ? String(i + 1) : ''));
            b.appendChild(el('span', 'tp-jump-t', labels[i]));
            b.title = labels[i];
            b.addEventListener('click', function (e) { jump(marks[i] ? marks[i].offset : mk.offset); if (e.detail && b.blur) b.blur(); });
            box.appendChild(b);
        });
        box.hidden = !marks.length;
        $('jumpsNone').hidden = !!marks.length;
        jumpCur = -2;
        updateHere();
    }
    // A click on a paragraph of the preview sends the prompter there.
    screen.addEventListener('click', function (e) {
        if (mode !== 'control') return;
        var off = renderer.offsetAt(e.target);
        if (off != null) jump(off);
    });
    // Ctrl+Enter (⌘+Enter) in the editor: the paragraph at the cursor.
    editor.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
        e.preventDefault();
        applyEditor();
        var B = model.blocks, k = editor.selectionStart, i;
        if (!B.length) return;
        for (i = 0; i < B.length; i++) if (k <= B[i].end) break;
        jump(B[Math.min(i, B.length - 1)].start);
    });

    // ---- target length and "fit the speed" (§5.5) ----
    function parseLength(v) {
        v = String(v || '').trim().replace(',', '.');
        if (!v) return 0;
        var m = /^(?:(\d+):)?(\d+):(\d{1,2})$/.exec(v);
        if (m) return (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]);
        if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 60);   // plain minutes
        return null;
    }
    function targetNote(msg) { $('targetNote').textContent = msg || ''; }
    var targetIn = $('target');
    targetIn.value = settings.target ? clock(settings.target) : '';
    targetIn.addEventListener('change', function () {
        var v = parseLength(targetIn.value);
        if (v == null || v >= 360000) { targetNote(tt('Write the length as minutes and seconds, like 3:30.')); return; }
        targetNote('');
        settings.target = v;
        targetIn.value = v ? clock(v) : '';
        saveSettings(); updateReadouts();
    });
    // The speed that ends the script on the target: the whole script from
    // the top, or what is left in the time that is left, mid-take.
    function fitSpeed() {
        if (!settings.target) { targetNote(tt('Set a target length first.')); targetIn.focus(); return; }
        var st = station.status(), fresh = st.progress < 0.001;
        var lines = (st.sl || 0) * (fresh ? 1 : 1 - st.progress), time = fresh ? settings.target : settings.target - st.elapsed;
        if (!(lines > 0)) { targetNote(''); return; }
        if (!(time > 0)) { targetNote(tt('The target time has already passed.')); return; }
        var v = lines / time, r = RANGE.speed;
        targetNote(v < r.min || v > r.max ? tt('That needs a speed the slider does not reach; it is set as close as it goes.') : '');
        settings.speed = snap('speed', v);
        $('speed').value = settings.speed;
        setSpeed();
        saveSettings(); updateUi();
    }
    onClick('fitBtn', fitSpeed);
    // A checkbox, slider or select changed with the mouse lets go of focus
    // too; changed from the keyboard, it keeps it.
    var byPointer = false;
    document.addEventListener('pointerdown', function () { byPointer = true; }, true);
    document.addEventListener('keydown', function () { byPointer = false; }, true);
    document.addEventListener('change', function (e) {
        var tg = e.target;
        if (byPointer && tg && tg.matches && tg.matches('input[type="checkbox"], input[type="range"], select') && tg.blur) tg.blur();
    }, true);

    // ---- the fixed key map (R7, prompter/input.js), in both modes ----
    var SPEED_STEP = 0.05;
    // Keys pressed in an output window arrive here too (as `key`), so
    // every window answers the same keys the same way.
    function onAction(action, remote) {
        switch (action) {
            case 'toggle': act('toggle'); break;
            case 'faster': changeSpeed(SPEED_STEP); break;
            case 'slower': changeSpeed(-SPEED_STEP); break;
            case 'back': act('nudge', -1); break;
            case 'forward': act('nudge', 1); break;
            case 'prevPara': act('paragraph', -1); break;
            case 'nextPara': act('paragraph', 1); break;
            case 'top': act('top'); break;
            case 'reverse': act('reverse'); break;
            case 'fullscreen': if (remote) return false; toggleFullscreen(); break;
            case 'escape': if (remote || mode !== 'present') return false; setMode('control'); break;
            default:
                var mk = /^jump[1-9]$/.test(action) ? marks[+action.slice(4) - 1] : null;
                if (!mk) return false;
                act('jump', mk.offset);
        }
        if (!remote) poke();
    }
    TP.input.attach(document, function (action) { return onAction(action, false); });


    // ---- outputs: other windows on other monitors (P2, §3 mode 2) ----
    // The control keeps a list of the output windows it can hear. Each has
    // its own mirror, flip and (when "same text size" is off) text size,
    // remembered per screen. The first output opened leads the scroll; this
    // window follows it, and its preview takes that output's size and
    // settings, so the preview is still what the reader sees.
    var KEY_OUTPUTS = 'teleprompter:outputs';
    var outputs = [], leadId = 'control', orderSeq = 0, openSeq = 0, settling = false;
    var scr = TP.screens.create(window, renderOutputs);

    function byId(id) { for (var i = 0; i < outputs.length; i++) if (outputs[i].id === id) return outputs[i]; return null; }
    function remembered(screenName) {
        var all = load(KEY_OUTPUTS) || {}, r = all[screenName || ''] || {};
        return { mirror: r.mirror === true, flip: r.flip === true, size: r.size == null ? settings.size : snap('size', r.size) };
    }
    function remember(o) {
        var all = load(KEY_OUTPUTS) || {};
        all[o.screen || ''] = { mirror: o.mirror, flip: o.flip, size: o.size };
        save(KEY_OUTPUTS, all);
    }
    function effective(o) {
        var r = renderSettings();
        r.mirror = o.mirror; r.flip = o.flip;
        r.size = settings.sameSize ? settings.size : o.size;
        return r;
    }
    function previewOutput() { return mode === 'control' ? byId(leadId) : null; }
    // This window's own renderer: the lead output's look in the preview,
    // the page's own settings when presenting here.
    function applyOwnSettings() {
        var o = previewOutput();
        renderer.setSettings(o ? effective(o) : renderSettings());
    }
    function labelsFor() {
        return { end: tt('End of script'), fs: tt('Click for full screen, or press F.'), alone: tt('Open this window from the Teleprompter controls.') };
    }
    function settingsMsg(o) {
        return { type: 'settings', to: o.id, s: effective(o), labels: labelsFor(), lang: lang(), countdown: +settings.countdown, speed: settings.speed };
    }
    function pushSettings(only) {
        if (!link) return;
        outputs.forEach(function (o) { if (!only || o === only) link.send(settingsMsg(o)); });
    }
    function sendScript(reset, to) {
        if (!link) return;
        var m = { type: 'script', text: model.text, reset: !!reset, anchor: renderer.anchor() };
        if (to) m.to = to;
        link.send(m);
    }
    // Ask whoever leads to say where it is now (a new follower needs a pos).
    function requestSync() {
        if (station.isLead()) station.changed();
        else if (link) link.send({ type: 'cmd', to: leadId, action: 'sync' });
    }

    // The first output (in the order they were opened) leads; with none,
    // this window does. A new lead carries on from the old one's last pos.
    function updateLead() {
        outputs.sort(function (a, b) { return a.order - b.order; });
        var next = outputs.length ? outputs[0].id : 'control';
        if (next === leadId) return;
        var seed = station.lastPos();
        leadId = next;
        station.setLead(next === 'control', seed);
        if (link) link.send({ type: 'lead', id: next, seed: seed });
        applyOwnSettings(); fitPreview(); renderOutputs(); updateUi();
    }
    function prune() {
        var now = Date.now(), before = outputs.length;
        outputs = outputs.filter(function (o) { return now - o.seen < 3500 && !(o.win && o.win.closed); });
        if (outputs.length !== before) { updateLead(); renderOutputs(); fitPreview(); }
    }
    function heartbeat() {
        if (!link) return;
        var m = { type: 'control' };
        if (!settling) m.lead = leadId;
        link.send(m);
        prune();
    }

    function onLinkMessage(m) {
        var o = byId(m.from);
        switch (m.type) {
            case 'hello':
                var isNew = !o;
                if (isNew) {
                    o = Object.assign({ id: m.from, order: m.lead ? -1 : ++orderSeq, screen: m.screen || '', fresh: true }, remembered(m.screen));
                    outputs.push(o);
                }
                var resized = o.w !== m.w || o.h !== m.h;
                o.seen = Date.now(); o.w = m.w; o.h = m.h;
                if (m.screen) o.screen = m.screen;
                if (o.fresh) {
                    o.fresh = false;
                    sendScript(false, o.id);
                    pushSettings(o);
                    // This page reloaded while that output was leading: it
                    // keeps leading, and this page follows from its pos.
                    if (m.lead && settling && leadId === 'control') {
                        o.order = -1;
                        leadId = o.id;
                        station.setLead(false);
                        if (m.pos) station.onPos(m.pos);
                    }
                    if (!settling) updateLead();
                    if (link) link.send({ type: 'lead', to: o.id, id: leadId });
                    requestSync();
                    renderOutputs();
                }
                if ((isNew || resized) && o.id === leadId) fitPreview();
                break;
            case 'bye':
                if (o) { outputs.splice(outputs.indexOf(o), 1); updateLead(); renderOutputs(); fitPreview(); }
                break;
            case 'key':
                onAction(m.action, true);
                break;
            case 'pos':
                station.onPos(m);
                break;
        }
    }

    function startLink() {
        renderOutputs();
        if (!link) return;
        // Outputs left open across a reload answer this with their hello.
        settling = true;
        link.send({ type: 'control', hello: true });
        setTimeout(function () { settling = false; updateLead(); heartbeat(); }, 700);
        setInterval(heartbeat, 1000);
    }

    // Two monitors of the same model share a label: number them apart.
    function screenName(e) {
        if (!e.label) return tt('Screen {n}').replace('{n}', e.n);
        var twin = scr.state().list.some(function (x) { return x !== e && x.label === e.label; });
        return twin ? e.label + ' (' + e.n + ')' : e.label;
    }
    function outputsOn(e) { var n = screenName(e); return outputs.filter(function (o) { return o.screen === n; }); }
    function openOutput(entry) {
        if (!link) return null;
        var id = TP.link.newId(++openSeq, Math.random());
        var name = entry ? screenName(entry) : '';
        var url = 'output.html#id=' + encodeURIComponent(id) + (name ? '&screen=' + encodeURIComponent(name) : '');
        var w = scr.open(url, 'tp-' + id, entry);
        if (!w) { outNote(tt('The browser blocked the window. Allow pop-ups for this site and try again.')); return null; }
        outNote('');
        // listed now; the window's hello fills in its size (it gets 10 s to load)
        var o = Object.assign({ id: id, order: ++orderSeq, screen: name, fresh: true, seen: Date.now() + 6500, win: w }, remembered(name));
        outputs.push(o);
        setMode('control');
        updateLead(); renderOutputs();
        return o;
    }
    function closeOutput(o) {
        if (o.win && !o.win.closed) { try { o.win.close(); } catch (e) { /* not ours */ } }
        if (link) link.send({ type: 'cmd', to: o.id, action: 'close' });
        outputs.splice(outputs.indexOf(o), 1);
        updateLead(); renderOutputs(); fitPreview();
    }
    function otherScreens() { return scr.state().list.filter(function (e) { return !e.current; }); }
    // The HUD's offer: one other screen → open there; otherwise the list.
    function offerOutputs() {
        var others = otherScreens(), st = scr.state();
        if (others.length === 1 && !outputs.length) { openOutput(others[0]); return; }
        setMode('control');
        if (st.api && st.permission === 'prompt') scr.detect();
        var head = $('outHead');
        if (head && head.scrollIntoView) head.scrollIntoView({ block: 'start' });
    }
    function outNote(msg) { $('outNote').textContent = msg || ''; }

    // The Screens section of the rail, rebuilt (DOM only) on every change.
    function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function checkbox(label, on, fn) {
        var l = el('label', 'check'), c = el('input');
        c.type = 'checkbox'; c.checked = on;
        c.addEventListener('change', function () { fn(c.checked); });
        l.appendChild(c); l.appendChild(document.createTextNode(' ')); l.appendChild(el('span', null, label));
        return l;
    }
    function button(label, fn, cls) {
        var b = el('button', 'cs-btn' + (cls ? ' ' + cls : ''), label);
        b.type = 'button';
        b.addEventListener('click', function (e) { fn(); if (e.detail && b.blur) b.blur(); });
        return b;
    }
    function renderOutputs() {
        var st = scr.state(), note = $('scrNote'), list = $('scrList'), outs = $('outList');
        if (!note) return;
        var others = otherScreens();
        // what the browser can tell about the monitors
        var msg;
        if (!link) msg = tt('This browser cannot open output windows. Present here still works.');
        else if (st.list.length > 1) msg = tt('{n} screens connected. Tick the ones that show the prompter.').replace('{n}', st.list.length);
        else if (st.list.length === 1) msg = tt('Only one screen is connected. Tick it to open an output window on it.');
        else if (st.api && st.permission === 'denied') msg = tt('Screen access was refused, so a window opens where the browser puts it: drag it to the other screen and press F.');
        else if (st.api && st.extended) msg = tt('Another screen is connected. Allow screen access to open the prompter on it.');
        else if (st.api && st.extended === false) msg = tt('Only one screen is connected. You can still open an output window on it.');
        else msg = tt('Open an output window, drag it to the other screen and press F there.');
        note.textContent = msg;

        // one row per monitor: ticked = a prompter window is open on it
        list.textContent = '';
        st.list.forEach(function (e) {
            var on = outputsOn(e), row = el('label', 'check tp-scr-row'), c = el('input');
            c.type = 'checkbox'; c.checked = on.length > 0; c.disabled = !link;
            c.addEventListener('change', function () {
                if (c.checked) { if (!openOutput(e)) c.checked = false; }
                else outputsOn(e).forEach(closeOutput);
            });
            row.appendChild(c);
            var txt = el('span', 'tp-scr-name');
            txt.appendChild(el('span', null, screenName(e)));
            txt.appendChild(el('span', 'tp-scr-dim', e.width + '×' + e.height + (e.current ? ' · ' + tt('this screen') : e.primary ? ' · ' + tt('main') : '')));
            row.appendChild(txt);
            on.forEach(function (o) { row.appendChild(el('span', 'tp-badge', tt('Output {n}').replace('{n}', outputs.indexOf(o) + 1))); });
            list.appendChild(row);
        });
        list.hidden = !link || !st.list.length;
        $('scrDetect').hidden = !link || !st.api || st.permission === 'granted' || st.permission === 'denied';
        $('outOpen').hidden = !link;
        $('sameSizeRow').hidden = !link || !outputs.length;
        $('sameSize').checked = settings.sameSize;

        outs.textContent = '';
        outputs.forEach(function (o, i) {
            var row = el('div', 'tp-out-row'), head = el('div', 'tp-out-head');
            head.appendChild(el('strong', null, String(i + 1)));
            head.appendChild(el('span', null, o.screen || tt('Output window')));
            if (o.id === leadId) head.appendChild(el('span', 'tp-badge', tt('Drives the scroll')));
            row.appendChild(head);
            var opts = el('div', 'tp-out-opts');
            opts.appendChild(checkbox(tt('Mirror left to right'), o.mirror, function (v) { o.mirror = v; changedOutput(o); }));
            opts.appendChild(checkbox(tt('Flip upside down'), o.flip, function (v) { o.flip = v; changedOutput(o); }));
            row.appendChild(opts);
            if (!settings.sameSize) {
                var f = el('div', 'field'), lb = el('label'), out = el('output', null, o.size + ' px'), r = el('input');
                lb.appendChild(el('span', null, tt('Text size'))); lb.appendChild(document.createTextNode(' ')); lb.appendChild(out);
                r.type = 'range'; r.min = RANGE.size.min; r.max = RANGE.size.max; r.step = RANGE.size.step; r.value = o.size;
                r.setAttribute('aria-label', tt('Text size') + ' ' + (i + 1));
                r.addEventListener('input', function () { o.size = snap('size', r.value); out.textContent = o.size + ' px'; changedOutput(o, true); });
                f.appendChild(lb); f.appendChild(r); row.appendChild(f);
            }
            var acts = el('div', 'tp-row');
            acts.appendChild(button(tt('Identify'), function () { if (link) link.send({ type: 'identify', to: o.id, label: String(i + 1) }); }));
            acts.appendChild(button(tt('Close'), function () { closeOutput(o); }));
            row.appendChild(acts);
            outs.appendChild(row);
        });

        // the HUD offers the other screen while presenting here
        var offer = !!link && (others.length > 0 || st.extended === true);
        $('hudOut').hidden = !offer;
        if (offer) setLabel($('hudOut'), others.length === 1 && !outputs.length ? 'Open on the other screen' : 'Other screens');
    }
    function changedOutput(o, quiet) {
        remember(o);
        pushSettings(o);
        if (o.id === leadId) applyOwnSettings();
        if (!quiet) renderOutputs();
    }
    $('scrDetect').addEventListener('click', function () { scr.detect(); });
    $('outOpen').addEventListener('click', function (e) { openOutput(null); if (e.detail) e.currentTarget.blur(); });
    $('sameSize').addEventListener('change', function () {
        settings.sameSize = $('sameSize').checked;
        saveSettings(); pushSettings(); applyOwnSettings(); renderOutputs();
    });

    window.addEventListener('pagehide', function () { saveScript(); savePos(); });

    // ---- start: Present here, the saved script (or the sample), still ----
    // app.js is deferred after i18n.js, so the sample starts in the page's
    // language: no English flash, and its saved position still applies.
    applyOwnSettings();
    renderer.setLabels({ end: tt('End of script') });
    var stored = load(KEY_SCRIPT);
    isSample = !(stored && typeof stored.text === 'string' && !stored.sample);
    var text = isSample ? tt(SAMPLE) : stored.text;
    editor.value = text;
    model = TP.model.parse(text);
    var pos = load(KEY_POS), a = null;
    if (pos && isSample) a = fromSampleSpot(model, pos.sample);
    else if (pos && pos.anchor && pos.len === text.length && isFinite(pos.anchor.offset) && isFinite(pos.anchor.frac)) {
        a = { offset: clamp(+pos.anchor.offset, 0, text.length), frac: clamp(+pos.anchor.frac, -1, 2) };
    }
    renderer.setModel(model, a);
    renderJumps();
    updateOutputs(); updateFsLabel(); updateUi();
    startLink();
    poke(4000);

    // i18n.js calls this after every language pass: the end marker, the
    // readouts, and the sample script if it is still the one showing. The
    // sample is swapped in place: same paragraph, playback undisturbed.
    window.repaintTp = function () {
        renderer.setLabels({ end: tt('End of script') });
        if (isSample) {
            var s = tt(SAMPLE);
            if (s !== editor.value) {
                var spot = sampleSpot(renderer.anchor());
                editor.value = s;
                model = TP.model.parse(s);
                renderer.setModel(model, fromSampleSpot(model, spot));
                sendScript();
            }
        }
        renderJumps();
        pushSettings(); renderOutputs();
        updateOutputs(); updateFsLabel(); updateUi();
    };

    // for tests and the P2 lead output
    window.TP.app = {
        renderer: renderer, motion: motion, player: player,
        mode: function () { return mode; }, setMode: setMode,
        anchor: function () { return renderer.anchor(); },
        state: player.state,
        station: station,
        outputs: function () { return outputs.map(function (o) { return { id: o.id, screen: o.screen, w: o.w, h: o.h, mirror: o.mirror, flip: o.flip, size: o.size }; }); },
        leadId: function () { return leadId; },
        screens: function () { return scr.state(); },
        openOutput: openOutput,
        here: here,
        marks: function () { return marks.slice(); },
        jump: jump,
        model: function () { return model; },
    };
})();
