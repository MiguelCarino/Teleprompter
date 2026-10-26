/* prompter/station.js — one window's place in a multi-window prompter (P2).

   Every window that shows the script (the control page, each output.html)
   has a renderer, a motion and a player. Exactly one of them is the LEAD
   (§4.3): its player runs the motion and it broadcasts `pos` messages.
   Every other window FOLLOWS: it does not run its own motion, it puts the
   lead's place on its own reading line — by position inside the paragraph
   (render.js locate/place), not by character, so a narrower screen that
   wraps more never leaps — and extrapolates with the lead's velocity
   between messages, so it moves every frame, not every message.
   A correction (a nudge, a seek, a late message) is not a jump: the gap
   between where the follower is and where it should be decays over about
   150 ms. A gap of more than a few lines (Home, a paragraph jump) snaps.

     var st = TP.station.create({ renderer, motion, player, link,
                                  onStatus() {…} });   // a pos arrived (follower)
     st.setLead(true | false, seedPos);  // the control decides who leads
     st.onPos(msg);                      // a `pos` from the lead
     st.layout(y);                       // the renderer's onLayout
     st.tick(t);  st.changed();          // the player's onTick / onChange (lead)
     st.status();                        // what the UI shows, lead or follower

   Classic script: window.TP.station in a page, module.exports in node. */
(function (root, factory) {
    var api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) { root.TP = root.TP || {}; root.TP.station = api; }
})(typeof self !== 'undefined' ? self : null, function () {
    'use strict';

    var SEND_EVERY = 80;     // ms between pos messages while moving
    var EASE = 0.15;         // s: how fast a follower closes a gap
    var SNAP_LINES = 3;      // a gap bigger than this is a jump, not a drift

    function create(o) {
        var renderer = o.renderer, motion = o.motion, player = o.player, link = o.link;
        var raf = o.raf || function (cb) { return requestAnimationFrame(cb); };
        var wall = o.wall || function () { return (performance.timeOrigin || 0) + performance.now(); };
        var onStatus = o.onStatus || function () {};

        var lead = o.lead !== false, lastSent = -1e9;
        var pos = null, err = 0, frame = 0, last = 0;

        // ---- lead: broadcast ----
        function snapshot() {
            return {
                type: 'pos',
                anchor: renderer.anchor(),
                loc: renderer.locate(),
                vel: motion.velocity,
                sl: renderer.scrollLines(),
                playing: motion.playing,
                running: player.running(),
                dir: motion.direction,
                ended: player.atEnd(),
                countdown: player.countdownLeft(),
                elapsed: motion.elapsed,
                progress: motion.progress,
                speed: motion.speed,
                t: wall(),
            };
        }
        function send(force) {
            if (!lead || !link) return;
            var now = wall();
            if (!force && now - lastSent < SEND_EVERY) return;
            lastSent = now;
            link.send(snapshot());
        }

        // ---- follower: chase the lead ----
        // Where to be now: the lead's place, moved on by its velocity (in
        // the lead's lines) for the time since it said so, then placed in
        // this window's own layout.
        function want() {
            var dt = Math.max(0, Math.min(2, (wall() - pos.t) / 1000));
            var loc = pos.loc ? renderer.advance(pos.loc, (pos.vel || 0) * dt) : null;
            var y = loc ? renderer.place(loc) : renderer.yFor(pos.anchor);
            var top = renderer.topY(), end = renderer.endY();
            return y < top ? top : y > end ? end : y;
        }
        function moving() { return pos && (Math.abs(pos.vel || 0) > 1e-6 || Math.abs(err) > 0.3); }
        function kick() { if (!frame && !lead) { last = 0; frame = raf(fTick) || 1; } }
        function fTick(t) {
            frame = 0;
            if (lead || !pos) return;
            var dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
            last = t;
            err *= Math.exp(-dt / EASE);
            if (Math.abs(err) < 0.3) err = 0;
            renderer.setY(want() + err);
            if (moving()) frame = raf(fTick) || 1;
        }
        function onPos(m) {
            if (lead) return;
            pos = m;
            var gap = renderer.y() - want();
            err = Math.abs(gap) > SNAP_LINES * renderer.lineHeight() ? 0 : gap;
            renderer.setCountdown(m.countdown == null ? null : m.countdown);
            renderer.setEnded(!!m.ended);
            if (m.speed) motion.setSpeed(m.speed);
            kick();
            onStatus(m);
        }

        function layout(y) {
            if (lead) return player.layout(y);
            // keep the bounds current (the WPM readout uses them)
            motion.setBounds(0, Math.max(0, player.posFromY(renderer.endY())));
            if (pos) { err = 0; kick(); }
        }

        function setLead(on, seed) {
            on = !!on;
            if (on === lead) return;
            lead = on;
            if (!lead) {
                // Stop driving. The motion is parked where the text is, so
                // the player's last frame does not pull it anywhere.
                motion.setPos(player.posFromY(renderer.y()));
                player.halt();
                renderer.setCountdown(null);
                pos = null;
                return;
            }
            // Leading now: carry on from where the old lead was.
            if (frame) frame = 0;
            var s = seed || pos;
            pos = null;
            if (s && s.anchor) {
                motion.setEnded(!!s.ended);
                if (s.dir) motion.setDirection(s.dir);
                if (s.speed) motion.setSpeed(s.speed);
                motion.setElapsed(s.elapsed);
                renderer.setAnchor(s.anchor);          // → layout → player.layout
                if (s.playing) player.play();
            }
            player.kick();
            send(true);
        }

        // What the readouts and buttons show.
        function status() {
            if (lead || !pos) {
                return {
                    lead: lead, running: player.running(), playing: motion.playing, dir: motion.direction,
                    ended: player.atEnd(), countdown: player.countingDown(), elapsed: motion.elapsed, progress: motion.progress,
                };
            }
            return {
                lead: false, running: !!pos.running, playing: !!pos.playing, dir: pos.dir || 1,
                ended: !!pos.ended, countdown: pos.countdown != null, elapsed: pos.elapsed || 0, progress: pos.progress || 0,
            };
        }

        return {
            setLead: setLead,
            isLead: function () { return lead; },
            onPos: onPos,
            layout: layout,
            tick: function () { send(false); },
            changed: function () { send(true); },
            snapshot: snapshot,
            lastPos: function () { return lead ? snapshot() : pos; },
            status: status,
        };
    }

    // A transport command, run by whichever window leads.
    function perform(player, action, arg) {
        switch (action) {
            case 'toggle': player.toggle(); break;
            case 'play': if (!player.running()) player.play(); break;
            case 'pause': if (player.running()) player.pause(); break;
            case 'top': player.top(); break;
            case 'nudge': player.nudge(+arg || 0); break;
            case 'paragraph': player.paragraph(+arg < 0 ? -1 : 1); break;
            case 'reverse': player.reverse(); break;
            case 'speed': player.setSpeed(+arg); break;
            default: return false;
        }
        return true;
    }

    return { create: create, perform: perform, SEND_EVERY: SEND_EVERY, EASE: EASE, SNAP_LINES: SNAP_LINES };
});
