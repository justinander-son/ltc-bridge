# LTC Chase for Premiere Pro

Makes Adobe Premiere Pro follow an external LTC timecode source delivered over a Dante audio network. When your timecode source plays, Premiere plays. When it stops, Premiere stops. When it jumps, Premiere chases there.

---

## What You Need

- **Mac** (Apple Silicon or Intel), macOS 12 or later
- **Adobe Premiere Pro** 25 or 26 (2025 or 2026)
- **Dante Virtual Soundcard** installed and licensed — [getdante.com](https://www.getdante.com)
- **LTC routed to a Dante receive channel** (channel 16 by default) in Dante Controller
- **An internet connection** for the one-time setup

---

## Installation

Open **Terminal** (`Cmd + Space` → type `Terminal` → Enter) and run each step in order.

---

### Step 1 — Xcode Command Line Tools

```bash
xcode-select --install
```

A dialog appears. Click **Install**. Wait for it to finish (a few minutes), then continue.

---

### Step 2 — Homebrew (package manager)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Follow the on-screen prompts. At the very end, if it shows you a line starting with `eval`, run that line too before continuing.

---

### Step 3 — Node.js and ffmpeg

```bash
brew install node ffmpeg
```

Confirm Node installed correctly — you should see `v20.x.x` or higher:

```bash
node --version
```

---

### Step 4 — Copy the project folder to this Mac

Copy the `ltc-chase` folder to your Mac. A good place is your home folder:

```
~/ltc-chase/
```

The folder should contain two sub-folders: `ltc-bridge` and `ltc-chase`.

---

### Step 5 — Run the installer

```bash
bash ~/ltc-chase/install.sh
```

This installs the Node.js dependencies and the Premiere panel in one shot. It will ask for your password once (needed to install for Premiere 2026).

Expected output:

```
✓ Bridge dependencies installed
✓ Debug mode enabled for Premiere
✓ Panel installed (user level)
✓ Panel installed (Premiere 2026 app bundle)

Restart Premiere Pro, then go to Window → Extensions → LTC Chase
```

---

### Step 6 — Restart Premiere Pro

Quit Premiere completely (`Cmd + Q`) and reopen it. Closing a project is not enough — it must be a full quit.

---

### Step 7 — Open the panel

In Premiere, go to **Window → Extensions → LTC Chase**.

A small dark panel appears. Dock it wherever you like. It will say **START BRIDGE FIRST** — that's normal.

---

## Daily Use

Every time you want LTC chase, open Terminal and run:

```bash
cd ~/ltc-chase/ltc-bridge && npm start
```

You'll see:

```
[WS]  Listening on ws://localhost:8765
[DVS] Opening: "Dante Virtual Soundcard", channel 16
[LTC] Bridge running — 48000 Hz, 30 fps, Dante ch16
[LTC] State machine: UNLOCKED → ACQUIRING (6 frames) → SEEKING → LOCKED

[WS]  Premiere plugin connected
```

Leave that Terminal window open. The Premiere panel updates to **WAITING FOR LTC**.

Roll your timecode source. Premiere chases to that position and plays. Stop your source — Premiere stops.

To shut down when done: click the Terminal window and press `Ctrl + C`.

---

## Panel Status

| Indicator | Meaning |
|---|---|
| Grey · **START BRIDGE FIRST** | The bridge isn't running. Run `npm start` in Terminal. |
| Grey · **NO BRIDGE — START IT** | Bridge was running but disconnected. Check the Terminal window. |
| Amber · **WAITING FOR LTC** | Bridge is running. No timecode signal yet. |
| Yellow · **SYNCING** | LTC detected. Premiere is seeking to the position. |
| Green · **CHASING** | Locked. Premiere is following the timecode. |
| Red · **STOPPED** | Timecode stopped. Premiere stopped. |
| Red · **PREMIERE ERROR** | Usually means no sequence is open in the timeline. |

---

## Configuration

Open `ltc-bridge/config.json` in any text editor. After changing anything, stop the bridge (`Ctrl + C`) and run `npm start` again.

```jsonc
{
  "danteDeviceName": "Dante Virtual Soundcard",
  "danteChannel": 16,
  "sampleRate": 48000,
  "frameRate": 30,
  "wsPort": 8765,
  "lockFramesNeeded": 6,
  "seekLatencyFrames": 10,
  "freewheelMs": 500,
  "stabilizeFrames": 20,
  "rewindConfirmCount": 2,
  "flywheelCount": 3,
  "softDriftFrames": 9999,
  "hardDriftFrames": 9999,
  "driftConfirmCount": 9999
}
```

| Setting | Default | What it does | How to tune |
|---|---|---|---|
| `danteDeviceName` | `"Dante Virtual Soundcard"` | Exact name of the audio input device as macOS sees it | Run `ffmpeg -f avfoundation -list_devices true -i ""` to list every audio device. Copy the name exactly. |
| `danteChannel` | `16` | Which Dante channel carries LTC (1-indexed) | Match the receive channel in Dante Controller |
| `sampleRate` | `48000` | Audio sample rate in Hz | 48000 is standard for Dante. Don't change unless you know why. |
| `frameRate` | `30` | LTC frame rate | Must match your LTC source: `24`, `25`, `29.97`, or `30` |
| `wsPort` | `8765` | Port the bridge listens on (the Premiere panel connects to this) | Only change if another app is already using 8765 |
| `lockFramesNeeded` | `6` | How many clean sequential LTC frames are required before Premiere seeks to the position | Lower = locks faster but may false-lock on noise. Higher = more conservative. Range: 3–10. |
| `seekLatencyFrames` | `10` | Frames added to the seek target to absorb the API round-trip to Premiere | If Premiere always arrives a bit early, increase. If late, decrease. Range: 5–15. |
| `freewheelMs` | `500` | Milliseconds of no-signal before Premiere stops | Lower = faster stop response. **Minimum safe value is ~150 ms** — below that, normal audio buffering gaps trigger false stops mid-playback. |
| `stabilizeFrames` | `20` | Frames to ignore jumps after a seek while Premiere's audio engine settles | Increase (to 30–40) if you see a spurious second seek immediately after the first. |
| `rewindConfirmCount` | `2` | Consecutive backward frames required to confirm a real rewind | Increase to `3` if random noise triggers accidental rewinds. |
| `flywheelCount` | `3` | Consecutive sequential frames at a new position required to confirm a real jump | This is the main garbage-frame filter. `3` is the tested sweet spot. Don't go below `2`. Increase to `4` if you see occasional false seeks. |
| `softDriftFrames` | `9999` | **Disabled.** Smoothed drift threshold (frames) before re-seeking | Leave disabled. If you re-enable (e.g. set to `8`), also set `driftConfirmCount` to `8`. The drift detector causes false seeks when audio arrives in batches. |
| `hardDriftFrames` | `9999` | **Disabled.** Instant re-seek threshold regardless of history | Leave disabled alongside `softDriftFrames`. |
| `driftConfirmCount` | `9999` | **Disabled.** Consecutive soft-drift frames needed to confirm | Only relevant if `softDriftFrames` is re-enabled. |

---

## Troubleshooting

**Panel doesn't appear in Window → Extensions**
- Confirm Premiere was fully quit and reopened (not just a project close).
- Confirm `install.sh` ran without errors.
- Check this file exists: `~/Library/Application Support/Adobe/CEP/extensions/com.studio59.ltcchase/CSXS/manifest.xml`
- For Premiere 2026, also check: `/Applications/Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app/Contents/CEP/extensions/com.studio59.ltcchase/`

**Bridge starts but panel says "START BRIDGE FIRST"**
- The WebSocket isn't connecting. Confirm the bridge printed `Listening on ws://localhost:8765`.
- A firewall or security tool may be blocking localhost connections. Check System Settings → Network → Firewall.

**Bridge starts but no LTC is detected**
- Open **System Settings → Sound → Input**, select Dante Virtual Soundcard, and confirm you see audio activity on the LTC channel.
- In Dante Controller, confirm the LTC source is patched to receive channel 16 (or whatever `danteChannel` is set to).
- Run `ffmpeg -f avfoundation -list_devices true -i ""` and confirm `Dante Virtual Soundcard` appears. If the device name is slightly different, update `danteDeviceName` in config.json to match exactly.

**Bridge says "Exited (code 1). Check device name"**
- Dante Virtual Soundcard isn't running. Its icon should be visible in the menu bar. Launch it and try again.

**Premiere seeks on initial lock but immediately seeks again**
- Increase `stabilizeFrames` from 20 to 30 in config.json. Premiere's audio engine is still ramping up when the second seek fires.

**Premiere stops unexpectedly during playback**
- Increase `freewheelMs`. Your Dante audio is having brief dropouts. Try 750 or 1000.

**LTC decodes but Premiere is a few frames off**
- Adjust `seekLatencyFrames`. Each increment = one frame. Try increasing by 2–3 if Premiere is consistently early.

---

## Testing Without Dante

To verify the state machine without any audio hardware:

```bash
cd ~/ltc-chase/ltc-bridge && node test/simulate.js
```

This runs 5 synthetic scenarios (lock-up, garbage frames, forward jump, rewind, burst garbage) and reports pass/fail for each. All 5 should pass.
