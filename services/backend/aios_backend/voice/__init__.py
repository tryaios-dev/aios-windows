"""Speech to text (ADR 0016): whisper-server and its process manager.

The UI never reaches it: its port and key stay inside the backend, like the chat engine's.
"""

from aios_backend.voice.launcher import VoiceError, Whisper
from aios_backend.voice.manager import VoiceManager, VoiceState

__all__ = ["VoiceError", "VoiceManager", "VoiceState", "Whisper"]
