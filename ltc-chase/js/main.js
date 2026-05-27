'use strict';

const csInterface = new CSInterface();
const BRIDGE_URL = 'ws://localhost:8765';
const TICKS_PER_SECOND = 254016000000;

const tcEl    = document.getElementById('timecode');
const dotEl   = document.getElementById('dot');
const labelEl = document.getElementById('state-label');
const seqEl   = document.getElementById('seq-name');
const errEl   = document.getElementById('error-detail');

let ws             = null;
let reconnectTimer = null;
let fps            = 30;

// ── ExtendScript helpers ──────────────────────────────────────────────────────

function evalScript(expr, cb) {
  csInterface.evalScript(expr, cb || function () {});
}

function refreshSequenceName() {
  evalScript('getSequenceName()', function (result) {
    try {
      const r = JSON.parse(result);
      seqEl.textContent = r.ok ? r.name : 'No sequence';
    } catch (_) {
      seqEl.textContent = '—';
    }
  });
}

// ── Timecode math ─────────────────────────────────────────────────────────────

function tcToTicks(h, m, s, f, framerate) {
  const totalFrames   = ((h * 3600 + m * 60 + s) * framerate) + f;
  const ticksPerFrame = Math.round(TICKS_PER_SECOND / framerate);
  return String(totalFrames * ticksPerFrame);
}

function formatTC(tc) {
  const p = (n) => String(n).padStart(2, '0');
  return `${p(tc.h)}:${p(tc.m)}:${p(tc.s)}:${p(tc.f)}`;
}

// ── UI ────────────────────────────────────────────────────────────────────────

function setUI(dotClass, label, tc, errorText) {
  dotEl.className     = 'dot ' + dotClass;
  labelEl.textContent = label;
  tcEl.textContent    = tc ? formatTC(tc) : '--:--:--:--';
  tcEl.classList.toggle('dim', !tc);
  errEl.textContent   = errorText || '';
}

// ── Message handler ───────────────────────────────────────────────────────────

function handleMessage(msg) {
  switch (msg.type) {

    case 'hello':
      fps = msg.fps || 30;
      refreshSequenceName();
      setUI('idle', 'WAITING FOR LTC', null, '');
      break;

    case 'play': {
      // Bridge has determined a seek is needed (initial lock, rewind, forward jump, drift)
      const ticks = tcToTicks(msg.tc.h, msg.tc.m, msg.tc.s, msg.tc.f, msg.fps || fps);
      setUI('seeking', 'SYNCING', msg.tc, '');

      evalScript('seekAndPlay("' + ticks + '")', function (result) {
        try {
          const r = JSON.parse(result);
          if (r.ok) {
            // Ack the bridge so it can transition SEEKING → LOCKED
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'seek_complete' }));
            }
            setUI('playing', 'CHASING', msg.tc, '');
          } else {
            setUI('error', 'PREMIERE ERROR', msg.tc, r.error);
          }
        } catch (e) {
          setUI('error', 'PARSE ERROR', msg.tc, String(e));
        }
      });
      break;
    }

    case 'stop':
      setUI('stopped', 'STOPPED', null, '');
      evalScript('stopPlayback()');
      break;

    case 'status':
      // LTC is rolling normally — update display only, Premiere runs free
      if (dotEl.className.includes('playing') || dotEl.className.includes('seeking')) {
        tcEl.textContent = formatTC(msg.tc);
      }
      break;
  }
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  if (ws) {
    ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
    ws.close();
  }

  ws = new WebSocket(BRIDGE_URL);

  ws.onopen = function () {
    clearTimeout(reconnectTimer);
  };

  ws.onmessage = function (event) {
    try {
      handleMessage(JSON.parse(event.data));
    } catch (e) {
      console.error('Bad message from bridge:', e);
    }
  };

  ws.onclose = function () {
    setUI('disconnected', 'NO BRIDGE — START IT', null, '');
    seqEl.textContent = '—';
    reconnectTimer = setTimeout(connect, 2000);
  };

  ws.onerror = function () {
    ws.close();
  };
}

// ── Init ──────────────────────────────────────────────────────────────────────

setInterval(refreshSequenceName, 5000);
setUI('disconnected', 'START BRIDGE FIRST', null, '');
connect();
