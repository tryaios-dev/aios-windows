# Golden vectors: network-allowlist v1

`cases.json` (G-08): allow/deny decisions every implementation of the allowlist must reproduce.
Each case gives the destination URL, the company server URL configured while the operator flag is
on (`null` = flag off) and whether a request may be sent. Redirects are checked hop by hop with
the same rule, so each hop is one case.

`services/backend/tests/test_allowlist_vectors.py` runs every case through the backend's network
door on every change. The hosts are the placeholders in `../allowlist.json` until B-06 records the
real ones; then the fixed-host cases are regenerated with them and `FROZEN` is added to `../`.
After that a change to an existing case is a semantic change and needs a new contract version and
an ADR.
