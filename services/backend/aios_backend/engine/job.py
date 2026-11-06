"""Kill-on-close job for engine processes (IPC-50), from the platform layer.

Windows: a Job Object, so the engine dies with the backend however the backend ends.
Elsewhere (CI and development only): no job; the parent-exit watch and orphan clean-up remain.
"""

from aios_common.platforms import ChildJob, current

__all__ = ["ChildJob", "kill_on_close_job"]


def kill_on_close_job() -> ChildJob:
    return current().kill_on_close_job()
