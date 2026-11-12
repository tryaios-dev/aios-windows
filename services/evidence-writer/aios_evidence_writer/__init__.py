"""evidence-writer.exe: owns evidence.db and the evidence signing key (Evidence Wire Format v1).

The backend submits content-free event intents over an authenticated loopback API; this process
hash-chains them, signs checkpoints and builds exports. Nothing else in the repository opens
evidence.db (invariant 5, M-12).
"""
