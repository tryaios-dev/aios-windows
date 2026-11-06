"""Windows Job Object with kill-on-close (Process and IPC Contract v1, IPC-50).

The backend holds the job handle for its whole life. When the backend ends, however it
ends (Electron quits it, TerminateProcess, a crash), Windows closes the handle and kills
every process in the job, so no llama-server is left holding gigabytes of RAM.
Imports on other OSes (for type checks) but only works on Windows.
"""

import subprocess
import sys

from aios_common.platforms.base import ChildJob

if sys.platform == "win32":
    import ctypes
    from ctypes import wintypes

    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS = 9
    _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

    class _IoCounters(ctypes.Structure):
        _fields_ = [
            (name, ctypes.c_ulonglong)
            for name in (
                "ReadOperationCount",
                "WriteOperationCount",
                "OtherOperationCount",
                "ReadTransferCount",
                "WriteTransferCount",
                "OtherTransferCount",
            )
        ]

    class _BasicLimits(ctypes.Structure):
        _fields_ = [
            ("PerProcessUserTimeLimit", ctypes.c_int64),
            ("PerJobUserTimeLimit", ctypes.c_int64),
            ("LimitFlags", wintypes.DWORD),
            ("MinimumWorkingSetSize", ctypes.c_size_t),
            ("MaximumWorkingSetSize", ctypes.c_size_t),
            ("ActiveProcessLimit", wintypes.DWORD),
            ("Affinity", ctypes.c_size_t),
            ("PriorityClass", wintypes.DWORD),
            ("SchedulingClass", wintypes.DWORD),
        ]

    class _ExtendedLimits(ctypes.Structure):
        _fields_ = [
            ("BasicLimitInformation", _BasicLimits),
            ("IoInfo", _IoCounters),
            ("ProcessMemoryLimit", ctypes.c_size_t),
            ("JobMemoryLimit", ctypes.c_size_t),
            ("PeakProcessMemoryUsed", ctypes.c_size_t),
            ("PeakJobMemoryUsed", ctypes.c_size_t),
        ]

    _kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _kernel32.CreateJobObjectW.restype = wintypes.HANDLE
    _kernel32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
    _kernel32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        wintypes.LPVOID,
        wintypes.DWORD,
    ]
    _kernel32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    _kernel32.CloseHandle.argtypes = [wintypes.HANDLE]

    def _check(ok: object) -> None:
        if not ok:
            raise OSError(ctypes.get_last_error(), "Job Object call failed")


class KillOnCloseJob(ChildJob):
    """Every process assigned here dies when ``close()`` runs or the backend exits."""

    def __init__(self) -> None:
        self._handle: int | None = None
        if sys.platform == "win32":
            handle = _kernel32.CreateJobObjectW(None, None)
            _check(handle)
            info = _ExtendedLimits()
            info.BasicLimitInformation.LimitFlags = _JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            _check(
                _kernel32.SetInformationJobObject(
                    handle,
                    _JOB_OBJECT_EXTENDED_LIMIT_INFORMATION_CLASS,
                    ctypes.byref(info),
                    ctypes.sizeof(info),
                )
            )
            self._handle = handle

    def assign(self, proc: "subprocess.Popen[bytes]") -> None:
        if sys.platform == "win32" and self._handle is not None:
            _check(_kernel32.AssignProcessToJobObject(self._handle, int(proc._handle)))  # type: ignore[attr-defined]

    def close(self) -> None:
        if sys.platform == "win32" and self._handle is not None:
            _kernel32.CloseHandle(self._handle)
            self._handle = None
