"""Voice. Speak instead of typing (ADR 0016). Backend side of apps/ui/src/features/voice.

The window sends audio from the microphone; whisper-server (aios_backend.voice) turns it into
text on this computer, phrase by phrase. Nothing is stored and nothing leaves the computer.
"""
