'use strict';

/**
 * Synthetic state-machine test — no audio hardware needed.
 *
 * Drives the state machine with programmatically generated frames and logs
 * every seek / flywheel event so you can see exactly what the machine does
 * with garbage frames, forward jumps, and rewinds.
 *
 * Usage:  node test/simulate.js
 */

const createStateMachine = require('../state-machine');

const config = {
  frameRate:         30,
  softDriftFrames:   3,
  hardDriftFrames:   15,
  driftConfirmCount: 4,
  lockFramesNeeded:  6,
  seekLatencyFrames: 10,
  freewheelMs:       2000,
  stabilizeFrames:   20,
  rewindConfirmCount: 2,
  flywheelCount:     3,
};

// Fake clock — advances by one frame period (33.3 ms) each tick so the
// drift detector sees realistic wall time without needing real delays.
const MS_PER_FRAME = 1000 / config.frameRate;
let fakeNow = Date.now();
const advanceClock = () => { fakeNow += MS_PER_FRAME; };

let seekCount = 0;
const seeks   = [];

const sm = createStateMachine(config, {
  onSeek:   (tc, fps) => { seekCount++; seeks.push({ ...tc }); },
  onStop:   ()        => console.log('  >> [STOP issued]'),
  onStatus: ()        => {},   // suppress per-frame noise
  log:      console.log,
  now:      ()        => fakeNow,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function absToRaw(absFrame) {
  const fps = config.frameRate;
  const totalSeconds = Math.floor(absFrame / fps);
  return {
    hours:   Math.floor(totalSeconds / 3600),
    minutes: Math.floor(totalSeconds / 60) % 60,
    seconds: totalSeconds % 60,
    frames:  absFrame % fps,
  };
}

function fmtAbs(abs) {
  const r = absToRaw(abs);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(r.hours)}:${p(r.minutes)}:${p(r.seconds)}:${p(r.frames)}`;
}

function playFrames(startAbs, count) {
  for (let i = 0; i < count; i++) {
    advanceClock();
    sm.onLTCFrame(absToRaw(startAbs + i));
  }
  return startAbs + count;   // returns next abs frame
}

function ackSeek(label) {
  console.log(`  >> seek_complete ACK  [${label}]`);
  sm.onSeekComplete();
}

function header(title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('═'.repeat(60));
  seekCount = 0;
  seeks.length = 0;
}

function assertSeeks(expected, label) {
  const pass = seekCount === expected;
  console.log(`\n  [${pass ? 'PASS' : 'FAIL'}] ${label}: expected ${expected} seek(s), got ${seekCount}`);
  if (seeks.length) {
    seeks.forEach((tc, i) => {
      const p = (n) => String(n).padStart(2, '0');
      console.log(`         seek #${i + 1} → ${p(tc.h)}:${p(tc.m)}:${p(tc.s)}:${p(tc.f)}`);
    });
  }
}

// ── Test 1: Normal lock-up ────────────────────────────────────────────────────

header('TEST 1 — Normal lock-up from UNLOCKED');

let pos = 108000;  // 01:00:00:00
pos = playFrames(pos, 6);           // 6 clean frames → ACQUIRING → SEEKING
ackSeek('initial lock');            // → LOCKED
pos = playFrames(pos, 50);          // play 50 frames locked (through stabilize window + drift zone)

assertSeeks(1, 'exactly 1 seek on startup');

// ── Test 2: Single isolated garbage frame (should be swallowed) ───────────────

header('TEST 2 — Single garbage frame while LOCKED (flywheel should suppress it)');
seekCount = 0; seeks.length = 0;

const garbage = pos + 50000;
console.log(`  Injecting 1 garbage frame at ${fmtAbs(garbage)} (real pos ${fmtAbs(pos)})`);
sm.onLTCFrame(absToRaw(garbage));   // isolated wild jump
pos = playFrames(pos, 5);           // back to normal immediately

assertSeeks(0, 'zero seeks — garbage frame was suppressed');

// ── Test 3: Real forward jump (3 consecutive at new position) ─────────────────

header('TEST 3 — Real forward jump (3 consecutive frames → seek)');
seekCount = 0; seeks.length = 0;

const jumpBase = pos + 50000;
console.log(`  Jumping from ${fmtAbs(pos)} to ${fmtAbs(jumpBase)} — feeding 4 sequential frames`);
pos = playFrames(jumpBase, 4);       // 3 frames confirm, 4th is in SEEKING state
ackSeek('forward jump');             // → LOCKED
pos = playFrames(pos, 5);

assertSeeks(1, 'exactly 1 seek on confirmed jump');

// ── Test 4: Rewind ────────────────────────────────────────────────────────────

header('TEST 4 — Rewind (3 consecutive backward frames → seek)');
seekCount = 0; seeks.length = 0;

pos = playFrames(pos, 25);          // get well past the 20-frame stabilize window
const rewindPos = pos - 300;        // 10 seconds back
console.log(`  Rewinding from ${fmtAbs(pos)} to ${fmtAbs(rewindPos)}`);
pos = playFrames(rewindPos, 4);     // 3 frames confirm rewind, 4th in SEEKING
ackSeek('rewind');

assertSeeks(1, 'exactly 1 seek on confirmed rewind');

// ── Test 5: Rapid garbage burst (should not cause repeated seeks) ─────────────

header('TEST 5 — Burst of 2 garbage frames (streak resets each time)');
seekCount = 0; seeks.length = 0;

pos = playFrames(pos, 25);          // back to locked, past stabilize
const g1 = pos + 40000;
const g2 = pos + 80000;             // different position each time — streak never reaches 3
console.log(`  Garbage frame 1 at ${fmtAbs(g1)}`);
sm.onLTCFrame(absToRaw(g1));
console.log(`  Garbage frame 2 at ${fmtAbs(g2)}`);
sm.onLTCFrame(absToRaw(g2));
pos = playFrames(pos, 5);           // back to normal

assertSeeks(0, 'zero seeks — non-sequential garbage burst suppressed');

// ── Done ──────────────────────────────────────────────────────────────────────

sm.stop();
console.log('\n' + '═'.repeat(60));
console.log('  Simulation complete.');
console.log('═'.repeat(60) + '\n');
