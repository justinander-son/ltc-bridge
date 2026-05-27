'use strict';

/**
 * LTC Test Generator
 *
 * Generates continuous LTC timecode audio and pipes it to stdout as raw
 * unsigned 8-bit (u8) mono PCM at 48 kHz. Pipe this into ffmpeg to play
 * it to any audio output device, including Dante Via.
 *
 * Usage:
 *   node test/ltc-generator.js | ffmpeg -f u8 -ar 48000 -ac 1 -i pipe:0 \
 *     -f audiotoolbox "4"
 *
 * (Device 4 = Dante Via 16 Channel — run with -list_devices to confirm index)
 *
 * Optional env vars:
 *   START_TC   Starting timecode  (default: 01:00:00:00)
 *   FPS        Frame rate         (default: 30)
 */

const { LTCEncoder } = require('libltc-wrapper');

const FPS        = parseInt(process.env.FPS || '30', 10);
const START_TC   = process.env.START_TC || '01:00:00:00';
const SAMPLE_RATE = 48000;

function parseTC(str) {
  const parts = str.split(':').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) {
    throw new Error(`Invalid START_TC "${str}" — use HH:MM:SS:FF format`);
  }
  return { hours: parts[0], minutes: parts[1], seconds: parts[2], frame: parts[3] };
}

const startTC = parseTC(START_TC);
const encoder = new LTCEncoder(SAMPLE_RATE, FPS);
encoder.setTimecode(startTC);

const pad = (n) => String(n).padStart(2, '0');
const { hours: h, minutes: m, seconds: s, frame: f } = startTC;
process.stderr.write(`[GEN] Generating LTC at ${FPS}fps starting ${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}\n`);
process.stderr.write('[GEN] Piping u8 PCM to stdout — ctrl+c to stop\n\n');

// Write frames as fast as stdout can consume them.
// Node's stream backpressure ensures we don't overproduce.
function writeNextFrame() {
  encoder.encodeFrame();
  const buf = encoder.getBuffer();
  encoder.incrementTimecode();

  const canContinue = process.stdout.write(buf);
  if (canContinue) {
    setImmediate(writeNextFrame);
  } else {
    process.stdout.once('drain', writeNextFrame);
  }
}

process.stdout.on('error', (err) => {
  if (err.code !== 'EPIPE') {
    process.stderr.write(`[GEN] stdout error: ${err.message}\n`);
  }
  process.exit(0);
});

process.on('SIGINT', () => {
  process.stderr.write('\n[GEN] Stopped.\n');
  process.exit(0);
});

writeNextFrame();
