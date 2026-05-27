'use strict';

module.exports = function createStateMachine(config, callbacks) {
  const {
    frameRate,
    softDriftFrames    = 3,
    hardDriftFrames    = 15,
    driftConfirmCount  = 4,
    lockFramesNeeded   = 6,
    seekLatencyFrames  = 10,
    freewheelMs        = 2000,
    stabilizeFrames    = 20,
    rewindConfirmCount = 2,
    flywheelCount      = 3,
  } = config;

  const { onSeek, onStop, onStatus, log = console.log, now = Date.now } = callbacks;

  const padTwo = (n) => String(n).padStart(2, '0');
  const fmtTC  = (tc) => `${padTwo(tc.h)}:${padTwo(tc.m)}:${padTwo(tc.s)}:${padTwo(tc.f)}`;

  function isValidTC(tc) {
    return tc.h >= 0 && tc.h <= 23 &&
           tc.m >= 0 && tc.m <= 59 &&
           tc.s >= 0 && tc.s <= 59 &&
           tc.f >= 0 && tc.f < frameRate;
  }

  function tcToAbsFrame(tc) {
    return (tc.h * 3600 + tc.m * 60 + tc.s) * frameRate + tc.f;
  }

  function absFrameToTC(absFrame) {
    const totalSeconds = Math.floor(absFrame / frameRate);
    return {
      h: Math.floor(totalSeconds / 3600),
      m: Math.floor(totalSeconds / 60) % 60,
      s: totalSeconds % 60,
      f: absFrame % frameRate,
    };
  }

  const PHASE = { UNLOCKED: 'UNLOCKED', ACQUIRING: 'ACQUIRING', SEEKING: 'SEEKING', LOCKED: 'LOCKED', STOPPED: 'STOPPED' };
  let phase = PHASE.UNLOCKED;

  let cleanFrameCount      = 0;
  let lastLtcFrame         = -1;
  let lockAnchorFrame      = -1;
  let lockAnchorWall       = -1;
  let driftSamples         = [];
  let consecutiveDrift     = 0;
  let seekIssuedAt         = -1;
  let pendingSeekFrame     = null;
  let lastSignalMs         = 0;
  let stabilizeCount       = 0;
  let consecutiveRewind    = 0;
  let flywheelFrame        = -1;
  let flywheelStreak       = 0;

  function transition(next, reason) {
    if (phase !== next) {
      log(`[STATE] ${phase} → ${next}${reason ? '  (' + reason + ')' : ''}`);
      phase = next;
    }
  }

  function classifyDelta(delta) {
    if (delta <= -30)  return 'REWIND';
    if (delta < 0)     return 'SKIP';
    if (delta <= 2)    return 'NORMAL';
    if (delta < 30)    return 'SKIP';
    return 'FORWARD_JUMP';
  }

  function recordLockAnchor(ltcFrame) {
    lockAnchorFrame  = ltcFrame;
    lockAnchorWall   = now();
    driftSamples     = [];
    consecutiveDrift = 0;
  }

  function measureDrift(currentLtcFrame) {
    const wallElapsed   = now() - lockAnchorWall;
    const framesElapsed = (wallElapsed / 1000) * frameRate;
    const expectedFrame = lockAnchorFrame + framesElapsed;
    return currentLtcFrame - expectedFrame;
  }

  function issueSeek(ltcFrame, reason) {
    const targetFrame = ltcFrame + seekLatencyFrames;
    const tc = absFrameToTC(targetFrame);
    log(`[SEEK] ${reason}  LTC=${fmtTC(absFrameToTC(ltcFrame))}  target=${fmtTC(tc)}  (+${seekLatencyFrames}f lead)`);
    onSeek(tc, frameRate);
    seekIssuedAt     = now();
    pendingSeekFrame = null;
    transition(PHASE.SEEKING, reason);
  }

  function onSeekComplete() {
    if (phase !== PHASE.SEEKING) return;

    if (pendingSeekFrame !== null) {
      const target = pendingSeekFrame;
      pendingSeekFrame = null;
      issueSeek(target, 'PENDING JUMP');
      recordLockAnchor(target);
      return;
    }

    recordLockAnchor(lastLtcFrame);
    stabilizeCount    = 0;
    consecutiveRewind = 0;
    transition(PHASE.LOCKED, 'seek ack received');
    log(`[LTC] LOCKED — Premiere chasing freely (${stabilizeFrames}-frame stabilization window)`);
  }

  function onLTCFrame(rawFrame) {
    const tc = {
      h: rawFrame.hours,
      m: rawFrame.minutes,
      s: rawFrame.seconds,
      f: rawFrame.frames,
    };

    if (!isValidTC(tc)) {
      log(`[LTC] Corrupt frame discarded: ${fmtTC(tc)}`);
      return;
    }

    const ltcFrame = tcToAbsFrame(tc);
    lastSignalMs = now();

    const delta    = lastLtcFrame >= 0 ? ltcFrame - lastLtcFrame : 1;
    const jumpType = lastLtcFrame >= 0 ? classifyDelta(delta) : 'NORMAL';

    if (jumpType === 'FORWARD_JUMP' || jumpType === 'REWIND') {
      const suspDelta = flywheelFrame >= 0 ? ltcFrame - flywheelFrame : 999;
      if (suspDelta >= 0 && suspDelta <= 2) {
        flywheelStreak++;
      } else {
        flywheelStreak = 1;
      }
      flywheelFrame = ltcFrame;

      if (flywheelStreak < flywheelCount) {
        log(`[FLYWHEEL] ${jumpType} at ${fmtTC(tc)} — awaiting confirmation (${flywheelStreak}/${flywheelCount})`);
        return;
      }

      consecutiveRewind = rewindConfirmCount;
      flywheelStreak    = 0;
      flywheelFrame     = -1;
    } else {
      flywheelFrame  = -1;
      flywheelStreak = 0;
    }

    lastLtcFrame = ltcFrame;
    onStatus(tc, frameRate);

    switch (phase) {

      case PHASE.UNLOCKED:
      case PHASE.STOPPED:
        if (jumpType === 'NORMAL') {
          cleanFrameCount = 1;
          transition(PHASE.ACQUIRING, 'signal detected');
        }
        break;

      case PHASE.ACQUIRING:
        if (jumpType === 'REWIND' || jumpType === 'FORWARD_JUMP') {
          cleanFrameCount = 1;
          break;
        }
        if (jumpType === 'SKIP') break;
        cleanFrameCount++;
        if (cleanFrameCount >= lockFramesNeeded) {
          issueSeek(ltcFrame, 'INITIAL LOCK');
          recordLockAnchor(ltcFrame);
        }
        break;

      case PHASE.SEEKING:
        if (jumpType === 'REWIND' || jumpType === 'FORWARD_JUMP') {
          pendingSeekFrame = ltcFrame;
        }
        if (now() - seekIssuedAt > 2000) {
          log('[SEEK] Timeout — retrying from UNLOCKED');
          cleanFrameCount = 0;
          transition(PHASE.UNLOCKED, 'seek timeout');
        }
        break;

      case PHASE.LOCKED:
        stabilizeCount++;

        if (stabilizeCount <= stabilizeFrames) {
          if (jumpType === 'NORMAL') recordLockAnchor(ltcFrame);
          break;
        }

        if (jumpType === 'REWIND') {
          consecutiveRewind++;
          if (consecutiveRewind >= rewindConfirmCount) {
            issueSeek(ltcFrame, 'REWIND');
            recordLockAnchor(ltcFrame);
            consecutiveRewind = 0;
          }
          break;
        }
        consecutiveRewind = 0;

        if (jumpType === 'FORWARD_JUMP') {
          issueSeek(ltcFrame, 'FORWARD JUMP');
          recordLockAnchor(ltcFrame);
          break;
        }

        {
          const drift = measureDrift(ltcFrame);
          driftSamples.push(drift);
          if (driftSamples.length > 8) driftSamples.shift();
          const smoothed = driftSamples.reduce((a, b) => a + b, 0) / driftSamples.length;
          const absDrift = Math.abs(smoothed);

          if (absDrift > hardDriftFrames) {
            log(`[DRIFT] Hard (${smoothed.toFixed(1)}f) — re-seeking`);
            issueSeek(ltcFrame, 'HARD DRIFT');
            recordLockAnchor(ltcFrame);
            break;
          }

          if (absDrift > softDriftFrames) {
            consecutiveDrift++;
            if (consecutiveDrift >= driftConfirmCount) {
              log(`[DRIFT] Soft confirmed (${smoothed.toFixed(1)}f × ${consecutiveDrift}) — re-seeking`);
              issueSeek(ltcFrame, 'SOFT DRIFT');
              recordLockAnchor(ltcFrame);
              consecutiveDrift = 0;
            }
          } else {
            consecutiveDrift = 0;
          }
        }
        break;
    }
  }

  const watchdog = setInterval(() => {
    if (phase === PHASE.UNLOCKED || phase === PHASE.STOPPED || phase === PHASE.ACQUIRING) return;
    if (lastSignalMs > 0 && now() - lastSignalMs > freewheelMs) {
      log('[LTC] Signal lost — STOPPED');
      onStop();
      transition(PHASE.STOPPED, 'signal lost');
      lastLtcFrame    = -1;
      cleanFrameCount = 0;
      driftSamples    = [];
      flywheelFrame   = -1;
      flywheelStreak  = 0;
    }
  }, 16);

  return {
    onLTCFrame,
    onSeekComplete,
    getPhase: () => phase,
    stop: () => clearInterval(watchdog),
  };
};
