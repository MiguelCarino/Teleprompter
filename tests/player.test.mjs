// node --test tests/ — player.js: the frame loop, countdown and end state,
// driven with a fake clock and a fake renderer (line units = pixels / 10).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const motionLib = require('../prompter/motion.js');
const playerLib = require('../prompter/player.js');

function rig(opts = {}) {
    const lh = 10;
    let lines = opts.lines || 20, y = lh / 2, ended = false, count = null, frames = [], t = 0, changes = 0, idles = 0;
    let paraYs = opts.paraYs || [5, 55, 105, 155];
    const renderer = {
        topY: () => lh / 2,
        endY: () => lh / 2 + lines * lh,
        lineHeight: () => lh,
        y: () => y,
        setY(v) { y = v; return true; },
        paraYs: () => paraYs,
        anchor: () => ({ offset: Math.round(y), frac: 0.5 }),
        setEnded(v) { ended = v; },
        setCountdown(n) { count = n; },
    };
    const motion = motionLib.create({ speed: opts.speed || 1, ramp: 0 });
    const player = playerLib.create({
        motion, renderer,
        raf: (cb) => { frames.push(cb); return frames.length; },
        now: () => t, wall: () => 1000 + t,
        onChange: () => { changes++; }, onIdle: () => { idles++; },
    });
    player.layout(y);
    // run the loop for `sec` seconds of 60 Hz frames
    function run(sec) {
        const end = t + sec * 1000;
        while (t < end && frames.length) { t += 1000 / 60; const f = frames; frames = []; f.forEach((cb) => cb(t)); }
        if (t < end) t = end;
    }
    return {
        motion, player, run,
        get y() { return y; }, get ended() { return ended; }, get count() { return count; },
        get changes() { return changes; }, get idles() { return idles; }, get looping() { return frames.length > 0; },
        grow(n, atEnd) { lines = n; player.layout(atEnd ? renderer.endY() : y); },
        relayout(n, newY, ys) { lines = n; if (ys) paraYs = ys; player.layout(newY); },
    };
}

test('play moves the renderer in line units; the loop goes idle on pause', () => {
    const r = rig();
    r.player.toggle();
    r.run(2);
    assert.ok(Math.abs(r.motion.pos - 2) < 0.05, String(r.motion.pos));
    assert.ok(Math.abs(r.y - (5 + r.motion.pos * 10)) < 1e-9);
    r.player.toggle();
    r.run(0.5);
    assert.equal(r.looping, false);
    assert.ok(r.idles >= 1, 'idle reported (the page saves then)');
    assert.equal(r.player.running(), false);
});

test('the countdown runs only from the top, not on a resume', () => {
    const r = rig();
    r.player.setCountdown(3);
    r.player.play();
    assert.equal(r.count, 3);
    assert.equal(r.motion.playing, false);
    assert.equal(r.player.running(), true);
    r.run(1.1);
    assert.equal(r.count, 2);
    r.run(2.1);
    assert.equal(r.count, null);
    assert.equal(r.motion.playing, true);
    r.run(1);
    r.player.pause(); r.run(0.5);
    r.player.play();
    assert.equal(r.player.countingDown(), false, 'resume mid-take: no countdown');
    assert.equal(r.motion.playing, true);
    r.player.top();
    r.player.play();
    assert.equal(r.player.countingDown(), true, 'from the top again: countdown');
});

test('reverse to the top stops, reports a change, and the next play goes forward', () => {
    const r = rig();
    r.motion.seek(1.5);
    r.player.reverse(); r.player.play();
    r.run(3);
    assert.equal(r.motion.pos, 0);
    assert.equal(r.player.running(), false, 'stopped (the page releases the wake lock)');
    assert.equal(r.motion.direction, 1);
    r.player.play(); r.run(1);
    assert.ok(r.motion.pos > 0.5, String(r.motion.pos));
});

test('the end state survives a relayout that still sits at the end', () => {
    const r = rig({ lines: 5, speed: 3 });
    r.player.play(); r.run(3);
    assert.equal(r.motion.ended, true);
    assert.equal(r.ended, true);
    assert.equal(r.player.atEnd(), true);
    r.grow(8, true);                 // bigger text, the anchor maps to the new end
    assert.equal(r.motion.ended, true);
    assert.equal(r.motion.pos, 8);
    assert.equal(r.ended, true, 'end marker kept');
    // bigger still: the last line rewraps, the anchor lands a line above the
    // new end but still in the last paragraph → still the end
    r.relayout(10, 5 + 9 * 10, [5, 25]);
    assert.equal(r.motion.ended, true);
    assert.equal(r.motion.pos, 10);
    assert.equal(r.y, 5 + 10 * 10, 'the renderer follows the snap');
    r.player.setCountdown(3);
    r.player.play();                 // = back to top, no countdown at the end
    assert.equal(r.motion.pos, 0);
    assert.equal(r.player.countingDown(), false);
    assert.equal(r.ended, false);
});

test('state carries a wall-clock timestamp for the lead broadcast', () => {
    const r = rig();
    const s = r.player.state();
    assert.equal(typeof s.t, 'number');
    assert.deepEqual(Object.keys(s).sort(), ['anchor', 'ended', 'playing', 't', 'velocity']);
});

test('a paragraph added after the end clears the end state; there is more to read', () => {
    const r = rig({ lines: 5, speed: 3, paraYs: [5] });
    r.player.play(); r.run(3);
    assert.equal(r.motion.ended, true);
    const y = r.y;
    r.relayout(8, y, [5, y + 20]);   // a new last paragraph below the reader
    assert.equal(r.motion.ended, false);
    assert.equal(r.ended, false, 'end marker cleared');
    assert.ok(Math.abs(r.motion.pos - 5) < 1e-9);
    r.player.play(); r.run(2);
    assert.equal(r.motion.ended, true);
    assert.equal(r.motion.pos, 8);
});
