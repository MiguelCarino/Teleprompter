/* prompter/player.js — one output's frame loop: motion.js driving render.js.

   The player owns what every lead output runs (the control page's
   "Present here" today, output.html in P2): the requestAnimationFrame
   loop, the line-unit ⇄ pixel bridge between motion and renderer, the
   countdown, the end marker, and the transport (play, pause, nudge, a
   paragraph back or on, reverse, top). It knows nothing about the control
   surface: readouts and labels hang off two callbacks.

     var player = TP.player.create({ motion, renderer,
         onChange() {…},   // the transport state changed (label, wake lock)
         onFrame() {…},    // at most every 200 ms while moving, and after a relayout
         onIdle() {…} });  // the loop went still (a good moment to save)
     // the renderer's onLayout must call player.layout(y)
     player.toggle(); player.nudge(1); player.state();

   The countdown runs only when playback starts from the top, so resuming
   mid-take never waits. Clocks are injectable for tests (raf, now, wall).

   Also here: wakeLock(), the Screen Wake Lock held while playing, which
   every lead output needs too. Classic script: window.TP.player in a page,
   module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.player = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    function noop() {}

    function create(o) {
        var motion = o.motion, renderer = o.renderer;
        var raf = o.raf || function (cb) { return requestAnimationFrame(cb); };
        var now = o.now || function () { return performance.now(); };
        // comparable across windows (§4.3); each document's now() alone is not
        var wall = o.wall || function () { return (performance.timeOrigin || 0) + performance.now(); };
        var onChange = o.onChange || noop, onFrame = o.onFrame || noop, onIdle = o.onIdle || noop;

        var frame = 0, last = 0, lastUi = 0, countdown = null, countdownSeconds = 0;

        function posFromY(y) { return (y - renderer.topY()) / renderer.lineHeight(); }
        function yFromPos(p) { return renderer.topY() + p * renderer.lineHeight(); }
        function changed() { renderer.setEnded(motion.ended); onChange(); }
        function clearCountdown() { if (countdown) { countdown = null; renderer.setCountdown(null); } }

        // The renderer re-anchored (size, font, window, text): same words,
        // new line units. At the end of the script the end state survives
        // as long as the reader is still in the last paragraph (bigger text
        // can rewrap its last line): the position snaps to the new end and
        // the renderer follows. Text added after it clears the end state.
        function layout(y) {
            var max = Math.max(0, posFromY(renderer.endY())), pos = posFromY(y);
            if (motion.ended) {
                var ys = renderer.paraYs();
                if (!ys.length || y >= ys[ys.length - 1] - 1e-6) pos = max;
            }
            var endChanged = motion.setLayout(0, max, pos);
            if (motion.ended && Math.abs(yFromPos(motion.pos) - y) > 1e-6) renderer.setY(yFromPos(motion.pos));
            if (endChanged) changed(); else onFrame();
        }

        function kick() { if (!frame) { last = 0; frame = raf(tick) || 1; } }
        function tick(t) {
            frame = 0;
            var dt = last ? (t - last) / 1000 : 0;
            last = t;
            if (countdown) {
                var left = Math.ceil((countdown.until - t) / 1000);
                if (left <= 0) { clearCountdown(); motion.play(); changed(); }
                else if (left !== countdown.shown) { countdown.shown = left; renderer.setCountdown(left); }
            }
            var was = motion.playing;
            var r = motion.step(dt);
            renderer.setY(yFromPos(motion.pos));
            if (r.ended || r.top || motion.playing !== was) changed();
            if (t - lastUi > 200) { lastUi = t; onFrame(); }
            if (motion.isActive() || countdown) frame = raf(tick) || 1;
            else { last = 0; changed(); onIdle(); }
        }

        function running() { return motion.playing || !!countdown; }
        function atEnd() { return motion.ended && motion.direction > 0; }
        function atTop() { return motion.pos <= motion.min + 1e-6; }
        function top() {
            clearCountdown();
            motion.stop(); motion.setDirection(1); motion.seek(0); motion.resetElapsed();
            renderer.setY(yFromPos(0));
            changed(); onIdle();
        }
        function play() {
            if (countdown) return;
            if (atEnd()) return top();
            if (countdownSeconds > 0 && atTop() && !countdown) {
                countdown = { until: now() + countdownSeconds * 1000, shown: countdownSeconds };
                renderer.setCountdown(countdownSeconds);
            } else motion.play();
            kick(); changed();
        }
        function pause() { clearCountdown(); motion.pause(); kick(); changed(); }
        function paragraph(dir) {
            var ys = renderer.paraYs(), y = renderer.y(), lh = renderer.lineHeight(), target = null, i;
            if (dir < 0) {
                for (i = ys.length - 1; i >= 0; i--) if (ys[i] < y - lh * 0.25) { target = ys[i]; break; }
                if (target == null) target = renderer.topY();
            } else {
                for (i = 0; i < ys.length; i++) if (ys[i] > y + lh * 0.25) { target = ys[i]; break; }
                if (target == null) target = renderer.endY();
            }
            motion.seek(posFromY(target), true);
            kick(); changed();
        }

        return {
            layout: layout,
            kick: kick,
            // the page was hidden: the next frame must not count that time
            resetClock: function () { last = 0; },
            running: running,
            atEnd: atEnd,
            countingDown: function () { return !!countdown; },
            setCountdown: function (sec) { countdownSeconds = Math.max(0, +sec || 0); },
            play: play,
            pause: pause,
            toggle: function () { if (running()) pause(); else play(); },
            top: top,
            nudge: function (lines) { motion.nudge(lines); kick(); changed(); },
            paragraph: paragraph,
            reverse: function () { motion.reverse(); kick(); changed(); },
            setSpeed: function (v) { var sp = motion.setSpeed(v); kick(); onFrame(); return sp; },
            posFromY: posFromY,
            yFromPos: yFromPos,
            // what a lead output broadcasts (§4.3)
            state: function () {
                return { anchor: renderer.anchor(), velocity: motion.velocity, playing: motion.playing, ended: motion.ended, t: wall() };
            },
        };
    }

    // Screen Wake Lock, held while `set(true)` and the page is visible; it
    // is re-requested when the page comes back. No-op without the API.
    function wakeLock(nav, doc) {
        var wanted = false, lock = null, pending = false;
        function sync() {
            if (!nav || !('wakeLock' in nav)) return;
            var visible = doc.visibilityState === 'visible';
            if (wanted && visible && !lock && !pending) {
                pending = true;
                nav.wakeLock.request('screen').then(function (l) {
                    pending = false; lock = l;
                    l.addEventListener('release', function () { if (lock === l) lock = null; });
                    if (!wanted || doc.visibilityState !== 'visible') sync();
                }, function () { pending = false; });
            } else if ((!wanted || !visible) && lock) {
                var l = lock; lock = null;
                l.release().catch(noop);
            }
        }
        if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', sync);
        return {
            set: function (on) { on = !!on; if (on !== wanted) { wanted = on; sync(); } },
            get held() { return !!lock; },
            get wanted() { return wanted; },
        };
    }

    return { create: create, wakeLock: wakeLock };
});
