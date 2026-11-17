# ADR 0016 — Voice: speech to text with whisper.cpp, on this computer

**Status:** proposed · **Date:** 2026-11-17

**Context.** The microphone button beside Send (conversation and Home) opens the listening panel
(`apps/ui/src/features/voice/VoicePanel.tsx`). Words should appear while the person speaks, a
pause or Done finishes, and the text lands in the message box; nothing is sent automatically and
nothing leaves the computer. The panel is finished; `useDictation.ts` only says "Voice is not in
this build yet". Voice is beyond the MVP spec. There is no speech engine, backend app or bridge
method yet, and the window denies every permission except clipboard writes.

**Spike** (2026-11-17, the 4-core reference VM: 4 cores of an i9-12900H, 8 GB, CPU only;
whisper.cpp b5454, ready-made Windows build; Italian and English clips of 6 s and 25 s;
language detected automatically). Time for one call:

| Model (multilingual, quantised) | Size | 6 s clip | 25 s clip | RAM | Text |
|---|---|---|---|---|---|
| base q5_1 | 60 MB | 1.6 s | 2.0 s | 215 MB | too many mistakes on short commands |
| small q5_1 | 190 MB | 6.3 s | 7.1 s | 480 MB | good |
| small q5_1, window fitted to the audio (`-ac`) | 190 MB | 3.8–4.9 s | 6.5–7.3 s | 480 MB | good, unchanged |
| small q5_1, fitted, greedy (`-bs 1 -bo 1`) | 190 MB | 3.6 s | 5.6 s | 360 MB | noticeably worse |
| large-v3-turbo q5_0 | 570 MB | 37 s | 38 s | 810 MB | near perfect; breaks with `-ac` |

- Language detection was right on every clip (it, en).
- Whisper always works on a 30 s window, so the cost per call hardly depends on the length of
  the audio. Fitting the window to the audio cuts it by about a third; flash attention (`-fa`)
  made it slower on this CPU.
- The ready-made build fails on a clean Windows (`0xC0000135`): it needs the Visual C++ runtime.

**Decision.**
- **Engine.** whisper.cpp (MIT), built from pinned source like llama-server (`build/voice/`,
  `manifest.json` with SHA-256), CPU and Vulkan builds, without a dependency on an installed
  Visual C++ runtime. It runs as its own process, `whisper-server`, on loopback.
- **Model.** Whisper small, multilingual, q5_1 (190 MB, MIT). Language detected
  automatically; `--translate` is not used, so the text is in the language that was spoken, and
  the chat model answers in that language.
- **Key.** A new derived token purpose `aios/ipc/v1/voice`, sent over stdin with a patch like
  `build/llama/patches/0001-api-key-stdin.patch`; without the key every request is refused.
  This adds a row to the Process and IPC contract (section 5) and a section like section 7.
- **Process manager.** The existing engine manager pattern (`aios_backend/engine/`): started on
  the first dictation, unloaded after idle, crash watch, orphan clean-up, inside the Job Object.
  A second engine kind, not a second manager. Its stdout and stderr are discarded, because
  whisper-server prints what it heard.
- **Phrase by phrase, while listening.** The backend keeps the audio in memory and splits it at
  pauses. Each finished phrase goes to whisper while the person keeps talking, with the window
  fitted to the phrase. Its text is added to `words`; the phrase still being spoken is not
  shown. On a pause at the end, or Done, the last phrase is written and the text goes to the
  message box. On the reference VM the text is about 4 s behind the voice; word by word within
  1 s is not reachable on CPU with a model that gets the words right. On machines with a GPU
  the Vulkan build is used, as for llama-server.
- **Audio path.** The renderer captures the microphone (`getUserMedia`, audio only) and an
  AudioWorklet turns it into 16 kHz mono 16-bit PCM. It computes the sound level for the rings
  and wave itself, with no IPC. Chunks of about 250 ms (8 KB) go through `window.aios.voice`
  to Electron main, which zod-validates them (size cap, session id) and forwards them to the
  backend; the backend forwards finished phrases to whisper. The renderer still has no network,
  port or token, and the CSP keeps `connect-src 'none'`.
- **No push channel.** The bridge has only `aios:invoke` (IPC-61), and live answers are already
  read by asking (`generation`). Voice does the same: each audio call returns the text so far,
  so the bridge needs no new channel.
- **Microphone permission.** `ALLOWED_PERMISSIONS` in `apps/desktop/src/main/window.ts` gains
  `media`, allowed only when every requested media type is `audio` and only for our own window.
  Video, screen capture and every other permission stay denied.
- **Backend app** `apps/voice/` (router, schemas, service), included in `main.py`:
  `POST /voice/sessions` (start), `POST /voice/sessions/{id}/audio` (a chunk; returns the text
  so far), `POST /voice/sessions/{id}/finish` (returns the final text),
  `DELETE /voice/sessions/{id}` (cancel), `GET /voice/status` (installed, engine state).
  One session at a time. `contracts/local-api/openapi.json` and the UI change land in the same
  pull request.
- **No microphone.** The panel's `no-mic` phase. The fix text, including the Windows privacy
  setting that blocks desktop apps from the microphone, lives in `apps/ui/src/lib/platform.ts`.

**Rules kept.**
- No audio and no text in logs, evidence or files; audio is in memory only and dropped when the
  phrase is written, or on cancel.
- No network: the model comes with the installer or through the model catalogue.
- Windows details only in the platform layers; tests first; lock files in the same PR.
- `whisper-server` is signed in `release.yml` like the llama builds; its licence and the
  model's go in `licenses/`.

**Open decisions** (the build works either way).
1. **Is the sound kept?** Proposed: no. The panel says so.
2. **Activity.** No evidence event for dictation now. A `dictation_used` event without content
   would need the wire-format owner.
3. **Language.** Automatic now; an optional setting can pass a fixed language to whisper later.
4. **In the first build?** The setup checklist's Voice line shows "ready" only when the model
   is installed. The backend looks for the model in the models folder, so shipping it with the
   installer or as a catalogue entry needs no code change.

**Consequences.**
- One more executable and one more model to build, sign and ship (about 190 MB more if it
  comes with the installer).
- About 480 MB of RAM while dictating, on top of the chat model if that is loaded.
- A contract change (new token purpose, engine section) and a security review for the
  microphone permission.
