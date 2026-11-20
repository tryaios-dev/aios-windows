import {
  VoiceAudio,
  VoiceFinished,
  VoiceLanguages,
  VoiceRecording,
  VoiceRecordingPart,
  VoiceRecordingSeconds,
  VoiceRecordingTarget,
  VoiceSession,
  VoiceSessionId,
  VoiceStatus,
  VoiceText,
} from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const session = (id: unknown) => `/voice/sessions/${VoiceSessionId.parse(id)}`;
const recording = (id: unknown) => `/voice/recordings/${VoiceSessionId.parse(id)}`;

/**
 * Speak instead of typing (ADR 0016). The window's microphone audio goes to the backend, which
 * turns it into text with whisper-server on this computer. Main never keeps or logs the audio.
 */
export const voiceHandlers: Record<string, Handler> = {
  "voice.status": async (b) => VoiceStatus.parse(await b.client.request("GET", "/voice/status")),
  "voice.downloadModel": async (b) => VoiceStatus.parse(await b.client.request("POST", "/voice/model")),
  "voice.start": async (b, languages) => {
    const body = { languages: VoiceLanguages.parse(languages ?? []) };
    return VoiceSession.parse(await b.client.request("POST", "/voice/sessions", body));
  },
  "voice.audio": async (b, id, pcm) => {
    const path = `${session(id)}/audio`;
    const audio = Buffer.from(VoiceAudio.parse(pcm)).toString("base64");
    return VoiceText.parse(await b.client.request("POST", path, { pcm: audio }));
  },
  "voice.finish": async (b, id) => VoiceFinished.parse(await b.client.request("POST", `${session(id)}/finish`)),
  "voice.cancel": async (b, id) => {
    await b.client.request("DELETE", session(id));
  },
  // Recording files (the Voice notes skill): the window decoded the file; main passes the audio on.
  "voice.recordingStart": async (b, seconds, languages) => {
    const body = { seconds: VoiceRecordingSeconds.parse(seconds), languages: VoiceLanguages.parse(languages ?? []) };
    return VoiceRecording.parse(await b.client.request("POST", "/voice/recordings", body));
  },
  "voice.recordingAudio": async (b, id, pcm) => {
    const audio = Buffer.from(VoiceRecordingPart.parse(pcm)).toString("base64");
    return VoiceRecording.parse(await b.client.request("POST", `${recording(id)}/audio`, { pcm: audio }));
  },
  "voice.recordingEnd": async (b, id) => VoiceRecording.parse(await b.client.request("POST", `${recording(id)}/end`)),
  "voice.recordingProgress": async (b, id) => VoiceRecording.parse(await b.client.request("GET", recording(id))),
  "voice.recordingStop": async (b, id) => VoiceRecording.parse(await b.client.request("POST", `${recording(id)}/stop`)),
  "voice.recordingTake": async (b, id, target) =>
    VoiceFinished.parse(await b.client.request("POST", `${recording(id)}/take`, VoiceRecordingTarget.parse(target ?? {}))),
  "voice.recordingDiscard": async (b, id) => {
    await b.client.request("DELETE", recording(id));
  },
};
