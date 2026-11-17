"""Sign a published model catalogue (Model Catalogue v1 section 5).

    uv run python tools/catalogue/sign.py catalogue.json < key.txt

Run by the release owner on the offline machine that holds the catalogue key. The key (the
32-byte Ed25519 seed as 64 hex characters) is read from stdin, never from an argument or the
environment. Writes catalogue.json.sig next to the catalogue and prints the key_id, which must be
one the app pins. The catalogue must already be canonical (JCS): it is signed byte for byte.
"""

import base64
import hashlib
import json
import sys
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

TAG = b"aios/model-catalogue/v1"


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        sys.stderr.write(__doc__ or "")
        return 2
    path = Path(argv[0])
    data = path.read_bytes()
    parsed = json.loads(data)
    if (
        json.dumps(parsed, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        != data
    ):
        sys.stderr.write("refused: the catalogue is not canonical JSON (JCS)\n")
        return 1
    if parsed.get("catalogue_version") != 1:
        sys.stderr.write("refused: catalogue_version is not 1\n")
        return 1
    key = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(sys.stdin.readline().strip()))
    public = key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)
    key_id = hashlib.sha256(b"aios/key/v1/ed25519\x00" + public).hexdigest()
    sig = key.sign(hashlib.sha256(TAG + b"\x00" + data).digest())
    out = {
        "alg": "ed25519",
        "key_id": key_id,
        "sig": base64.urlsafe_b64encode(sig).rstrip(b"=").decode(),
    }
    path.with_name(path.name + ".sig").write_bytes(
        json.dumps(out, sort_keys=True, separators=(",", ":")).encode()
    )
    print(f"signed with key_id {key_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
