/**
 * LTC Chase — ExtendScript
 * Runs inside Premiere Pro's scripting engine, called from the CEP panel.
 */

function seekAndPlay(ticks) {
    try {
        var seq = app.project.activeSequence;
        if (!seq) {
            return JSON.stringify({ ok: false, error: 'No active sequence' });
        }

        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (!qeSeq) {
            return JSON.stringify({ ok: false, error: 'QE sequence unavailable' });
        }

        // Stop if playing so the seek lands cleanly
        if (qeSeq.player.isPlaying) {
            qeSeq.player.play(0);
        }

        seq.setPlayerPosition(ticks);
        qeSeq.player.play(1);

        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function stopPlayback() {
    try {
        app.enableQE();
        var qeSeq = qe.project.getActiveSequence();
        if (qeSeq) qeSeq.player.play(0);
        return JSON.stringify({ ok: true });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}

function getSequenceName() {
    try {
        var seq = app.project.activeSequence;
        if (!seq) return JSON.stringify({ ok: false });
        return JSON.stringify({ ok: true, name: seq.name });
    } catch (e) {
        return JSON.stringify({ ok: false, error: e.toString() });
    }
}
