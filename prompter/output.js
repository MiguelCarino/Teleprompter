/* prompter/output.js — output.html: one projected prompter window (P2).

   The control page opens this window (on another monitor, or anywhere)
   and drives it over the channel in link.js. It shows only the script:
   everything it knows (text, settings, labels in the page's language)
   comes from the control. It may be the lead — the window whose player
   runs the scroll and broadcasts where it is — or a follower of the lead.

   It keeps going on its own: if the control page goes quiet (closed,
   crashed, reloading) a small red dot appears and the text keeps moving,
   so the talent is never frozen mid-sentence (§4.4). When the control
   comes back it finds this window again from its hello. */
(function () {
    'use strict';
    var TP = window.TP;
    var $ = function (id) { return document.getElementById(id); };

    // #id=o1-xyz&screen=Label — the control chooses both; a reload keeps them.
    var hash = new URLSearchParams(location.hash.slice(1));
    var id = hash.get('id');
    if (!id) {
        id = TP.link.newId(0, Math.random());
        hash.set('id', id);
        history.replaceState(null, '', '#' + hash.toString());
    }
    var screenLabel = hash.get('screen') || '';

    var labels = { end: 'End of script', fs: 'Click for full screen, or press F.', alone: 'Open this window from the Teleprompter controls.', ident: '' };
    var note = $('note'), ident = $('ident'), lost = $('lost'), screenEl = $('screen');

    // ---- engine: the same modules as the control page ----
    var motion = TP.motion.create({});
    var model = TP.model.parse('');
    var station = null, player = null;
    var renderer = TP.render.create(screenEl, { onLayout: function (y) { if (station) station.layout(y); } });
    var wake = TP.player.wakeLock(navigator, document);
    var link = TP.link.open(id, onMessage);
    player = TP.player.create({
        motion: motion, renderer: renderer,
        onChange: function () { station.changed(); wake.set(station.status().running); },
        onTick: function () { station.tick(); },
    });
    station = TP.station.create({
        renderer: renderer, motion: motion, player: player, link: link, lead: false,
        onStatus: function (m) { wake.set(!!m.running); },
    });
    renderer.setLabels({ end: labels.end });

    // ---- the control page ----
    var controlSeen = 0;
    function controlAlive() { return Date.now() - controlSeen < 3000; }
    function hello() {
        if (!link) return;
        link.send({ type: 'hello', screen: screenLabel, w: window.innerWidth, h: window.innerHeight, lead: station.isLead(), pos: station.isLead() ? station.snapshot() : null });
    }
    function onMessage(m) {
        switch (m.type) {
            case 'control':
                controlSeen = Date.now();
                lost.hidden = true;
                // a control that just loaded names no lead yet: it is still
                // listening for which output was leading
                if (m.lead != null && (m.lead === id) !== station.isLead()) station.setLead(m.lead === id, m.seed || null);
                if (m.hello) hello();
                break;
            case 'script':
                if (m.text === model.text) break;
                // a replaced script starts at the top; an edit keeps the place
                var a = m.reset ? null : model.text ? renderer.anchor() : (m.anchor || null);
                if (!m.reset && model.text && a) a = { offset: TP.model.mapOffset(model.text, m.text, a.offset), frac: a.frac };
                model = TP.model.parse(m.text);
                renderer.setModel(model, a);
                break;
            case 'settings':
                if (m.s) renderer.setSettings(m.s);
                if (m.labels) {
                    Object.assign(labels, m.labels);
                    renderer.setLabels({ end: labels.end });
                    if (!note.hidden && !fsElement()) note.textContent = labels.fs;
                }
                if (m.lang) document.documentElement.lang = m.lang;
                if (m.countdown != null) player.setCountdown(+m.countdown);
                if (m.speed) player.setSpeed(+m.speed);
                break;
            case 'lead':
                station.setLead(m.id === id, m.seed || null);
                break;
            case 'cmd':
                if (m.action === 'close') { window.close(); break; }
                if (!station.isLead()) break;
                if (m.action === 'sync') station.changed();
                else TP.station.perform(player, m.action, m.arg);
                break;
            case 'pos':
                station.onPos(m);
                break;
            case 'identify':
                ident.textContent = m.label || '';
                ident.hidden = false;
                clearTimeout(identTimer);
                identTimer = setTimeout(function () { ident.hidden = true; }, 2500);
                break;
        }
    }
    var identTimer = 0;

    if (!link) {
        note.textContent = labels.alone;
    } else {
        hello();
        setInterval(function () {
            hello();
            if (controlSeen && !controlAlive()) lost.hidden = false;
        }, 1000);
        window.addEventListener('pagehide', function () { link.send({ type: 'bye' }); });
        window.addEventListener('resize', hello);
    }

    // ---- full screen: it needs a gesture in this window ----
    function fsElement() { return document.fullscreenElement || document.webkitFullscreenElement || null; }
    function toggleFullscreen() {
        if (fsElement()) {
            var ex = document.exitFullscreen || document.webkitExitFullscreen;
            if (ex) { try { var p = ex.call(document); if (p && p.catch) p.catch(function () {}); } catch (e) { /* not allowed */ } }
            return;
        }
        var el = document.documentElement, req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (req) { try { var q = req.call(el); if (q && q.catch) q.catch(function () {}); } catch (e) { /* no gesture */ } }
    }
    // The first click anywhere makes it full screen, once; after that F
    // and a double-click toggle it.
    var firstClick = true;
    if (link) note.textContent = labels.fs;
    function hideNote() { note.hidden = true; }
    var noteTimer = setTimeout(hideNote, 8000);
    document.addEventListener('pointerdown', function () {
        if (firstClick && !fsElement()) { firstClick = false; toggleFullscreen(); }
    });
    screenEl.addEventListener('dblclick', function () {
        var sel = window.getSelection && window.getSelection();
        if (sel && sel.removeAllRanges) sel.removeAllRanges();
        toggleFullscreen();
    });
    document.addEventListener('fullscreenchange', function () { if (fsElement()) { clearTimeout(noteTimer); hideNote(); firstClick = false; } });

    // ---- keys: the control page routes them, so every window acts alike.
    // With the control gone, a lead output still answers the transport. ----
    TP.input.attach(document, function (action) {
        if (action === 'fullscreen') { toggleFullscreen(); return; }
        if (action === 'escape') return false;          // the browser leaves full screen
        if (link && controlAlive()) { link.send({ type: 'key', action: action }); return; }
        if (!station.isLead()) return false;
        var map = { toggle: ['toggle'], back: ['nudge', -1], forward: ['nudge', 1], prevPara: ['paragraph', -1],
            nextPara: ['paragraph', 1], top: ['top'], reverse: ['reverse'],
            faster: ['speed', motion.speed + 0.05], slower: ['speed', motion.speed - 0.05] };
        var c = map[action];
        if (!c) return false;
        TP.station.perform(player, c[0], c[1]);
    });

    // ---- the cursor hides when the mouse is still ----
    var idleTimer = 0;
    function poke() {
        document.body.classList.remove('idle');
        clearTimeout(idleTimer);
        idleTimer = setTimeout(function () { document.body.classList.add('idle'); }, 2000);
    }
    document.addEventListener('pointermove', poke);
    poke();
    document.addEventListener('visibilitychange', function () { player.resetClock(); });

    // for tests
    window.TP.out = { id: id, renderer: renderer, motion: motion, player: player, station: station };
})();
