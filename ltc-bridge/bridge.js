'use strict';

const { spawn } = require('child_process');
const { LTCDecoder } = require('libltc-wrapper');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const createStateMachine = require('./state-machine');

// ── Config ────────────────────────────────────────────────────────────────────

const configArg = process.argv.find((a) => a.startsWith('--config='));
const configFile = configArg
  ? path.resolve(__dirname, configArg.split('=')[1])
  : path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));

const { danteDeviceName, danteChannel, sampleRate, frameRate, wsPort } = config;

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ port: wsPort });

wss.on('listening', () => console.log(`[WS]  Listening on ws://localhost:${wsPort}`));

wss.on('connection', (client) => {
  console.log('[WS]  Premiere plugin connected');
  client.send(JSON.stringify({ type: 'hello', fps: frameRate }));

  client.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'seek_complete') sm.onSeekComplete();
    } catch (_) {}
  });

  client.on('close', () => console.log('[WS]  Premiere plugin disconnected'));
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(data);
  });
}

// ── State machine ─────────────────────────────────────────────────────────────

const sm = createStateMachine(config, {
  onSeek:   (tc, fps) => broadcast({ type: 'play', tc, fps }),
  onStop:   ()        => broadcast({ type: 'stop' }),
  onStatus: (tc, fps) => broadcast({ type: 'status', tc, fps }),
  log:      console.log,
});

// ── Audio capture via ffmpeg ──────────────────────────────────────────────────

const channelIndex = danteChannel - 1;

const ffmpegArgs = [
  '-hide_banner',
  '-loglevel', 'warning',
  '-f', 'avfoundation',
  '-guess_layout_max', '0',
  '-i', `:${danteDeviceName}`,
  '-af', `aeval=val(${channelIndex}):c=mono,aformat=sample_fmts=s16:channel_layouts=mono:sample_rates=${sampleRate}`,
  '-f', 's16le',
  'pipe:1',
];

function startFFmpeg() {
  console.log(`[DVS] Opening: "${danteDeviceName}", channel ${danteChannel}`);
  console.log(`[DVS] ffmpeg args: ${ffmpegArgs.join(' ')}`);

  const ff = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  ff.stdout.on('data', (chunk) => {
    decoder.write(chunk);
    let frame;
    while ((frame = decoder.read()) !== undefined) sm.onLTCFrame(frame);
  });

  let stderrBuf = '';
  ff.stderr.on('data', (data) => {
    stderrBuf += data.toString();
    const lines = stderrBuf.split('\n');
    stderrBuf = lines.pop();
    for (const line of lines) {
      if (line.trim()) console.log('[FFMPEG]', line);
    }
  });

  ff.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') {
      console.error(`\n[FFMPEG] Exited (code ${code}). Check device name in config.json.`);
      console.error('[FFMPEG] Run:  ffmpeg -f avfoundation -list_devices true -i ""  to list audio devices.\n');
    }
  });

  return ff;
}

const decoder   = new LTCDecoder(sampleRate, frameRate, 's16');
const ffmpegProcess = startFFmpeg();

console.log(`[LTC] Bridge running — ${sampleRate} Hz, ${frameRate} fps, Dante ch${danteChannel}`);
console.log(`[LTC] State machine: UNLOCKED → ACQUIRING (${config.lockFramesNeeded || 6} frames) → SEEKING → LOCKED\n`);

process.on('SIGINT', () => {
  console.log('\n[LTC] Shutting down...');
  ffmpegProcess.kill('SIGTERM');
  wss.close();
  process.exit(0);
});
