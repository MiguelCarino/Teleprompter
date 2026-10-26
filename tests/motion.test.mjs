// node --test tests/ — motion.js: time-based, refresh-rate independent motion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const motion = require('../prompter/motion.js');

function run(m, seconds, hz, onFrame) {
    const dt = 1 / hz, frames = Math.round(seconds * hz);
    for (let f = 0; f < frames; f++) { if (onFrame) onFrame(m, f * dt); m.step(dt); }
}
const close = (a, b, tol) => Math.abs(a - b) <= tol * Math.max(Math.abs(a), Math.abs(b), 1e-9);

test('same distance at 60 Hz and 144 Hz over 10 s (within 1 %)', () => {
    const a = motion.create({ speed: 0.8 }), b = motion.create({ speed: 0.8 });
    a.play(); b.play();
    run(a, 10, 60); run(b, 10, 144);
    assert.ok(a.pos > 7, 'it moved: ' + a.pos);
    assert.ok(close(a.pos, b.pos, 0.01), '60 Hz ' + a.pos + ' vs 144 Hz ' + b.pos);
    // the integration is exact, so it is far better than 1 %
    assert.ok(Math.abs(a.pos - b.pos) < 1e-9);
});

test('same distance with speed changes, a pause and uneven frame times', () => {
    const drive = (frameTimes) => {
        const m = motion.create({ speed: 0.6 });
        m.play();
        let t = 0, sped = false, paused = false, resumed = false;
        for (const dt of frameTimes) {
            if (!sped && t >= 2) { m.setSpeed(1.5); sped = true; }
            if (!paused && t >= 5) { m.pause(); paused = true; }
            if (!resumed && t >= 6) { m.play(); resumed = true; }
            m.step(dt); t += dt;
        }
        return m.pos;
    };
    const steady60 = Array(600).fill(1 / 60);
    const steady144 = Array(1440).fill(1 / 144);
    // a 144 Hz display that drops a frame now and then
    const jitter = []; let acc = 0, i = 0;
    while (acc < 10 - 1e-9) { const dt = Math.min(i % 37 === 0 ? 2 / 144 : 1 / 144, 10 - acc); jitter.push(dt); acc += dt; i++; }
    const p60 = drive(steady60), p144 = drive(steady144), pj = drive(jitter);
    // events land on the first frame at or after their time, so allow 1 %
    assert.ok(close(p60, p144, 0.01), p60 + ' vs ' + p144);
    assert.ok(close(p60, pj, 0.01), p60 + ' vs ' + pj);
});

test('speed is line-heights per second once the ramp is over', () => {
    const m = motion.create({ speed: 2, ramp: 0.5 });
    m.play();
    run(m, 0.5, 120);
    const at = m.pos;
    run(m, 1, 120);
    assert.ok(close(m.pos - at, 2, 1e-9), 'moved ' + (m.pos - at) + ' in 1 s');
});

test('start ramps over 0.5 s: half the distance of an instant start', () => {
    const m = motion.create({ speed: 1, ramp: 0.5 });
    m.play();
    m.step(0.05);
    assert.ok(m.velocity > 0 && m.velocity < 0.1, 'slow at first: ' + m.velocity);
    run(m, 0.45, 100);
    // ∫ smoothstep over the ramp = half the ramp at full speed
    assert.ok(close(m.pos, 0.25, 1e-9), String(m.pos));
    assert.ok(close(m.velocity, 1, 1e-9));
});

test('pause eases to a stop; the loop goes idle afterwards', () => {
    const m = motion.create({ speed: 1, ramp: 0.5 });
    m.play(); run(m, 2, 60);
    const at = m.pos;
    m.pause();
    assert.ok(m.isActive());
    run(m, 1, 60);
    assert.ok(close(m.pos - at, 0.25, 1e-9), 'coasted ' + (m.pos - at));
    assert.equal(m.velocity, 0);
    assert.equal(m.isActive(), false);
});

test('a long frame (hidden tab) is clamped, so the text never leaps', () => {
    const m = motion.create({ speed: 1, ramp: 0, maxDt: 0.1 });
    m.play();
    m.step(30);
    assert.ok(close(m.pos, 0.1, 1e-9), String(m.pos));
});

test('reverse runs backwards through zero velocity and stops at the top', () => {
    const m = motion.create({ speed: 1, ramp: 0.5 });
    m.setBounds(0, 100);
    m.play(); run(m, 3, 60);
    m.reverse();
    assert.equal(m.direction, -1);
    run(m, 0.25, 60);
    assert.ok(m.velocity > -1 && m.velocity < 1, 'mid-ramp: ' + m.velocity);
    run(m, 10, 60);
    assert.equal(m.pos, 0);
    assert.equal(m.playing, false);
});

test('reaching the end stops with an end state; play is refused until you go back', () => {
    const m = motion.create({ speed: 2, ramp: 0 });
    m.setBounds(0, 5);
    m.play();
    let endedFrames = 0;
    for (let f = 0; f < 600; f++) if (m.step(1 / 60).ended) endedFrames++;
    assert.equal(m.pos, 5);
    assert.equal(m.ended, true);
    assert.equal(m.playing, false);
    assert.equal(endedFrames, 1, 'ended reported once');
    assert.equal(m.play(), false);
    m.seek(0);
    assert.equal(m.ended, false);
    assert.equal(m.play(), true);
});

test('nudge moves exactly one line, eased, also while paused', () => {
    const m = motion.create({ speed: 1 });
    m.setBounds(0, 50);
    m.seek(10);
    m.nudge(1);
    m.step(0.1);
    assert.ok(m.pos > 10 && m.pos < 11);
    run(m, 0.3, 60);
    assert.ok(close(m.pos, 11, 1e-9), String(m.pos));
    m.nudge(-1); m.nudge(-1);
    run(m, 0.5, 60);
    assert.ok(close(m.pos, 9, 1e-9), String(m.pos));
});

test('animated seek lands on the target; bounds clamp it', () => {
    const m = motion.create({ speed: 1 });
    m.setBounds(0, 20);
    m.seek(12, true);
    run(m, 0.5, 60);
    assert.ok(close(m.pos, 12, 1e-9));
    m.seek(99);
    assert.equal(m.pos, 20);
});

test('elapsed counts playing time only', () => {
    const m = motion.create({ speed: 1 });
    m.setBounds(0, 1000);
    m.play(); run(m, 2, 60);
    m.pause(); run(m, 3, 60);
    assert.ok(close(m.elapsed, 2, 1e-6), String(m.elapsed));
    m.resetElapsed();
    assert.equal(m.elapsed, 0);
});

test('speed is clamped and WPM follows words per line', () => {
    const m = motion.create();
    assert.equal(m.setSpeed(0), motion.MIN_SPEED);
    assert.equal(m.setSpeed(99), motion.MAX_SPEED);
    // 0.5 lines/s with 4 words per line = 120 WPM
    assert.equal(motion.wpm(0.5, 400, 100), 120);
    assert.equal(motion.wpm(1, 10, 0), 0);
});

test('reverse playback that reaches the top turns forward, so the next play moves', () => {
    const m = motion.create({ speed: 1, ramp: 0.5 });
    m.setBounds(0, 20);
    m.seek(2); m.reverse(); m.play();
    let top = 0;
    for (let f = 0; f < 300; f++) if (m.step(1 / 60).top) top++;
    assert.equal(m.pos, 0);
    assert.equal(m.playing, false);
    assert.equal(m.direction, 1, 'forward again');
    assert.equal(top, 1, 'top reported once');
    assert.equal(m.play(), true);
    run(m, 1, 60);
    assert.ok(m.pos > 0.2, 'it moves: ' + m.pos);
});

test('play at the top with reverse set plays forward', () => {
    const m = motion.create({ speed: 1, ramp: 0 });
    m.setBounds(0, 20);
    m.reverse();
    assert.equal(m.direction, -1);
    m.play();
    assert.equal(m.direction, 1);
    run(m, 1, 60);
    assert.ok(close(m.pos, 1, 1e-9), String(m.pos));
});

test('a backward nudge near the top while playing clamps and keeps playing', () => {
    const m = motion.create({ speed: 1, ramp: 0.5 });
    m.setBounds(0, 50);
    m.play(); run(m, 1, 60);
    assert.ok(m.pos > 0.3 && m.pos < 1);
    m.nudge(-1);
    run(m, 0.3, 60);
    assert.equal(m.playing, true);
    assert.ok(m.pos >= 0);
    run(m, 1, 60);
    assert.ok(m.pos > 0.5, 'still moving forward: ' + m.pos);
});

test('a forward nudge at the end while playing in reverse clamps and keeps reversing', () => {
    const m = motion.create({ speed: 1, ramp: 0 });
    m.setBounds(0, 10);
    m.seek(9.9); m.reverse(); m.play();
    m.nudge(2);
    run(m, 0.3, 60);
    assert.equal(m.playing, true);
    assert.equal(m.ended, false);
    run(m, 1, 60);
    assert.ok(m.pos < 9.9, String(m.pos));
});

test('setLayout keeps the end state when the relayout still sits at the end', () => {
    const m = motion.create({ speed: 2, ramp: 0 });
    m.setBounds(0, 5); m.play(); run(m, 5, 60);
    assert.equal(m.ended, true);
    // bigger text: more line units, the anchor maps to the new end
    assert.equal(m.setLayout(0, 8, 8), false);
    assert.equal(m.ended, true);
    assert.equal(m.pos, 8);
    assert.equal(m.play(), false, 'still at the end');
    // within rounding of the end counts as the end
    assert.equal(m.setLayout(0, 9, 9 - 1e-9), false);
    assert.equal(m.ended, true);
    // text added below the reader: there is more to read now
    assert.equal(m.setLayout(0, 12, 9), true);
    assert.equal(m.ended, false);
    assert.equal(m.pos, 9);
});

test('WPM over the scroll distance: gaps between paragraphs count', () => {
    // 5 one-line paragraphs, 20 words: 5 text lines but 8 lines of scrolling
    // (4 gaps, minus the line that starts on the reading line)
    assert.equal(motion.wpm(1, 20, 8), 150);
    assert.ok(motion.wpm(1, 20, 8) < motion.wpm(1, 20, 5));
});
