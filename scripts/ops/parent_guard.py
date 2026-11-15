"""Linux exec wrapper: terminate the service if its outer manager disappears."""
import ctypes
import os
import signal
import sys

if __name__ == '__main__':
    try:
        expected = int(sys.argv[1])
        if sys.platform != 'linux' or expected <= 1 or len(sys.argv) < 3: raise ValueError()
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.prctl(1, signal.SIGTERM, 0, 0, 0) != 0: raise OSError()
        # Closes the race where the parent dies before PR_SET_PDEATHSIG is installed.
        if os.getppid() != expected: raise RuntimeError()
        os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
    except Exception:
        print('HOST_PARENT_GUARD_FAILED', file=sys.stderr)
        sys.exit(1)
