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
        speed: { min: 0.1, max: 3, step: 0.05, def: 0.6 },
        size: { min: 24, max: 300, step: 2, def: Math.round(clamp(window.innerWidth / 12, 40, 160) / 2) * 2 },
        spacing: { min: 1, max: 2, step: 0.05, def: 1.25 },
        margin: { min: 0, max: 30, step: 1, def: 8 },
        linePos: { min: 0, max: 100, step: 1, def: 40 },
    };
    var CHOICE = {
        font: ['display', 'sans', 'mono'],
        lineStyle: ['arrows', 'line', 'band', 'hidden'],
        countdown: ['0', '3', '5', '10'],
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
        return s;
    }
    var settings = loadSettings();
    function renderSettings() {
        return {
            size: settings.size, spacing: settings.spacing, margin: settings.margin, font: settings.font,
            mirror: settings.mirror, flip: settings.flip, linePos: settings.linePos, lineStyle: settings.lineStyle, dim: settings.dim,
        };
    }

    // ---- engine: one renderer (the output), its motion, the frame loop ----
    var screen = $('screen'), frame = $('frame'), hud = $('hud'), editor = $('editor');
    var motion = TP.motion.create({ speed: settings.speed });
    var model = TP.model.parse('');
    var isSample = true;
    var player = null;
    var renderer = TP.render.create(screen, { onLayout: function (y) { if (player) player.layout(y); } });
    var wake = TP.player.wakeLock(navigator, document);
    player = TP.player.create({
        motion: motion, renderer: renderer,
        onChange: function () { wake.set(player.running()); updateUi(); },
        onFrame: updateReadouts,
        onIdle: savePos,
    });
    player.setCountdown(+settings.countdown);

    function changeSpeed(d) {
        settings.speed = snap('speed', settings.speed + d);
        $('speed').value = settings.speed;
        player.setSpeed(settings.speed);
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
        renderer.check();
    }
    // The preview is the output at the window's size, scaled into the frame.
    function fitPreview() {
        if (mode !== 'control') return;
        var W = window.innerWidth, H = window.innerHeight;
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
    function speedText() {
        // words over the scroll distance (gaps between paragraphs included)
        var w = TP.motion.wpm(settings.speed, renderer.words(), Math.max(1, motion.max));
        return num(settings.speed, 2) + ' ' + tt('lines/s') + ' · ≈ ' + w + ' ' + tt('WPM');
    }
    function setLabel(el, key) { el.dataset.i18nKey = key; el.textContent = tt(key); }
    function updateReadouts() {
        var pos = Math.round(motion.progress * 100) + ' %', time = clock(motion.elapsed), sp = speedText();
        $('hudPos').textContent = pos; $('ctlPos').textContent = pos;
        $('hudTime').textContent = time; $('ctlTime').textContent = time;
        $('hudSpeed').textContent = sp; $('ctlSpeed').textContent = sp;
        $('speedVal').textContent = sp;
        $('hudPos').title = tt('Position'); $('hudTime').title = tt('Elapsed'); $('hudSpeed').title = tt('Speed');
    }
    function updateUi() {
        var run = player.running(), end = player.atEnd(), countdown = player.countingDown();
        var key = run ? 'Pause' : end ? 'Back to top' : 'Play';
        ['playBtn', 'playBtn2', 'hudPlay'].forEach(function (id) {
            var b = $(id);
            setLabel(b, key);
            b.setAttribute('aria-pressed', run ? 'true' : 'false');
        });
        $('revBtn').setAttribute('aria-pressed', motion.direction < 0 ? 'true' : 'false');
        var st = countdown ? 'countdown' : motion.playing ? 'playing' : end ? 'ended' : 'paused';
        var stEl = $('ctlState');
        stEl.dataset.state = st;
        stEl.textContent = tt({ countdown: 'Countdown', playing: motion.direction < 0 ? 'Playing in reverse' : 'Playing', ended: 'End of script', paused: 'Paused' }[st]);
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

    // An edit: re-render, carrying the anchor through the change.
    function applyEditor() {
        clearTimeout(renderTimer);
        var text = editor.value;
        if (text === model.text) return;
        var a = renderer.anchor();
        var mapped = { offset: TP.model.mapOffset(model.text, text, a.offset), frac: a.frac };
        model = TP.model.parse(text);
        renderer.setModel(model, mapped);
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
        player.top();
        saveScript();
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
            if (k === 'speed') player.setSpeed(settings.speed);
            else renderer.setSettings(renderSettings());
            updateOutputs(); updateReadouts(); saveSettings();
        });
    });
    Object.keys(CHOICE).forEach(function (k) {
        var sel = $(k);
        sel.value = settings[k];
        sel.addEventListener('change', function () {
            settings[k] = CHOICE[k].indexOf(sel.value) >= 0 ? sel.value : CHOICE[k][0];
            if (k === 'countdown') player.setCountdown(+settings.countdown);
            else renderer.setSettings(renderSettings());
            updateReadouts(); saveSettings();
        });
    });
    FLAGS.forEach(function (k) {
        var cb = $(k);
        cb.checked = settings[k];
        cb.addEventListener('change', function () {
            settings[k] = cb.checked;
            renderer.setSettings(renderSettings());
            saveSettings();
        });
    });

    // ---- buttons and fields: a mouse click gives focus back to the page,
    // so Space keeps meaning play/pause; keyboard use keeps focus ----
    function onClick(id, fn) {
        var b = $(id);
        b.addEventListener('click', function (e) { fn(); if (e.detail && b.blur) b.blur(); });
    }
    onClick('playBtn', player.toggle); onClick('playBtn2', player.toggle); onClick('hudPlay', player.toggle);
    onClick('presentBtn', function () { setMode('present'); });
    onClick('hudCtl', function () { setMode('control'); });
    onClick('hudFs', toggleFullscreen);
    onClick('topBtn', player.top);
    onClick('prevBtn', function () { player.paragraph(-1); });
    onClick('nextBtn', function () { player.paragraph(1); });
    onClick('revBtn', player.reverse);
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
    TP.input.attach(document, function (action) {
        switch (action) {
            case 'toggle': player.toggle(); break;
            case 'faster': changeSpeed(SPEED_STEP); break;
            case 'slower': changeSpeed(-SPEED_STEP); break;
            case 'back': player.nudge(-1); break;
            case 'forward': player.nudge(1); break;
            case 'prevPara': player.paragraph(-1); break;
            case 'nextPara': player.paragraph(1); break;
            case 'top': player.top(); break;
            case 'reverse': player.reverse(); break;
            case 'fullscreen': toggleFullscreen(); break;
            case 'escape': if (mode !== 'present') return false; setMode('control'); break;
            default: return false;
        }
        poke();
    });

    window.addEventListener('pagehide', function () { saveScript(); savePos(); });

    // ---- start: Present here, the saved script (or the sample), still ----
    // app.js is deferred after i18n.js, so the sample starts in the page's
    // language: no English flash, and its saved position still applies.
    renderer.setSettings(renderSettings());
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
    updateOutputs(); updateFsLabel(); updateUi();
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
            }
        }
        updateOutputs(); updateFsLabel(); updateUi();
    };

    // for tests and the P2 lead output
    window.TP.app = {
        renderer: renderer, motion: motion, player: player,
        mode: function () { return mode; }, setMode: setMode,
        anchor: function () { return renderer.anchor(); },
        state: player.state,
    };
})();
