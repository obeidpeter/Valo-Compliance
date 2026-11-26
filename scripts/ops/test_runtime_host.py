import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

import runtime_host as host


class RuntimeConfigTest(unittest.TestCase):
    def test_backup_credentials_and_startup_hooks_do_not_reach_runtime(self):
        env = {'NODE_ENV': 'production', 'DATABASE_URL': 'synthetic-db', 'AWS_SECRET_ACCESS_KEY': 'synthetic-b2',
               'RESTIC_PASSWORD_FILE': 'private', 'VALO_RESTIC_PASSWORD': 'private', 'VALO_BACKUP_MONITOR_URL': 'private',
               'NODE_OPTIONS': '--require unsafe', 'LD_PRELOAD': 'unsafe'}
        self.assertEqual(host.process_environment(env), {'NODE_ENV': 'production', 'DATABASE_URL': 'synthetic-db'})

    def test_each_service_login_reaches_only_the_process_that_uses_it(self):
        env = {'NODE_ENV': 'production', 'DATABASE_URL': 'synthetic-db',
               'VALO_DRAFTER_DATABASE_URL': 'synthetic-drafting', 'VALO_REVIEWER_DATABASE_URL': 'synthetic-review',
               'VALO_PUBLISHER_DATABASE_URL': 'synthetic-publishing', 'VALO_DRAFTER_LOGIN_PASSWORD': 'private',
               'VALO_REVIEWER_LOGIN_PASSWORD': 'private', 'VALO_PUBLISHER_LOGIN_PASSWORD': 'private'}
        serving = {'NODE_ENV': 'production', 'DATABASE_URL': 'synthetic-db'}
        # Drafting's connection reaches the worker alone; review's and the publisher's, and any login's
        # password, neither.
        self.assertEqual(host.process_environment(env, 'worker'), {**serving, 'VALO_DRAFTER_DATABASE_URL': 'synthetic-drafting'})
        self.assertEqual(host.process_environment(env, 'api'), serving)
        self.assertEqual(host.process_environment(env), serving)

    def test_production_gate_never_uses_configuration_only_or_overrides_mode(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); gate=root/'artifacts/api-server/dist/production-preflight.mjs';gate.parent.mkdir(parents=True);gate.write_text('')
            with patch.object(host.subprocess, 'run', return_value=subprocess.CompletedProcess([], 2)) as call:
                with self.assertRaisesRegex(Exception, 'PRODUCTION_ACTIVATION_NOT_APPROVED'):
                    host.production_gate({'mode': 'production', 'sourceRoot': str(root)}, {'NODE_ENV': 'production'})
                self.assertNotIn('--configuration-only', call.call_args.args[0])
                self.assertEqual(call.call_args.kwargs['env']['NODE_ENV'], 'production')


@unittest.skipUnless(sys.platform == 'linux', 'Linux parent-death supervision')
class ProcessSupervisionTest(unittest.TestCase):
    def test_outer_manager_loss_signals_the_real_service(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);ready=root/'ready';stopped=root/'stopped'
            service=root/'service.py'
            service.write_text("import pathlib,signal,time,sys\nready,stopped=map(pathlib.Path,sys.argv[1:])\ndef stop(*_):\n stopped.write_text('drained');sys.exit(0)\nsignal.signal(signal.SIGTERM,stop);ready.write_text('ready')\nwhile True:time.sleep(.01)\n")
            manager=root/'manager.py'
            manager.write_text("import sys,threading\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nfrom runtime_host import supervise\nsupervise({'worker':[sys.executable,sys.argv[2],sys.argv[3],sys.argv[4]]},Path(sys.argv[5]),{},Path(sys.argv[5]),threading.Event())\n")
            parent=subprocess.Popen([sys.executable,str(manager),str(Path(host.__file__).parent),str(service),str(ready),str(stopped),str(root)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            try:
                until=time.monotonic()+8
                while not ready.exists() and time.monotonic()<until:time.sleep(.02)
                self.assertTrue(ready.exists())
                parent.kill();parent.wait()
                until=time.monotonic()+5
                while not stopped.exists() and time.monotonic()<until:time.sleep(.02)
                self.assertEqual(stopped.read_text(),'drained')
            finally:
                if parent.poll() is None:parent.kill();parent.wait()

    def test_reused_pid_is_never_signalled(self):
        import json
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);record={'pid':123456,'group':123456,'startTicks':'1','uid':os.getuid()}
            path=root/'runtime-children.json';path.write_text(json.dumps([record]));path.chmod(0o600)
            with patch.object(host,'process_identity',return_value={**record,'startTicks':'2'}),patch.object(host.os,'killpg') as kill:
                host.recover_previous(root,grace=.01)
                kill.assert_not_called()

    def test_real_child_crash_restarts_then_drains_on_shutdown(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d); marker=root/'runs'
            script=root/'child.py'
            script.write_text("import pathlib,signal,time,sys\np=pathlib.Path(sys.argv[1]);n=int(p.read_text())+1 if p.exists() else 1;p.write_text(str(n))\nif n==1:sys.exit(1)\nsignal.signal(signal.SIGTERM,lambda *_:sys.exit(0))\nwhile True:time.sleep(.01)\n")
            stop=threading.Event(); failures=[]
            def run():
                try:host.supervise({'worker':[sys.executable,str(script),str(marker)]},root,dict(os.environ),root,stop,grace=2,restart_delay=.01,poll=.01)
                except Exception as error:failures.append(error)
            thread=threading.Thread(target=run);thread.start()
            try:
                until=time.monotonic()+8
                while time.monotonic()<until and (not marker.exists() or marker.read_text()!='2'):time.sleep(.02)
                self.assertEqual(marker.read_text(),'2')
            finally:stop.set();thread.join(5)
            self.assertFalse(thread.is_alive());self.assertEqual(failures,[])

    def test_real_children_start_with_their_own_environments(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            script=root/'child.py'
            script.write_text("import os,pathlib,signal,time,sys\npathlib.Path(sys.argv[1]).write_text(os.environ.get('VALO_DRAFTER_DATABASE_URL','absent'))\nsignal.signal(signal.SIGTERM,lambda *_:sys.exit(0))\nwhile True:time.sleep(.01)\n")
            env={**os.environ,'VALO_DRAFTER_DATABASE_URL':'synthetic-drafting'}
            seen={name:root/(name+'.seen') for name in ('api','worker')}
            commands={name:[sys.executable,str(script),str(path)] for name,path in seen.items()}
            stop=threading.Event(); failures=[]
            def run():
                try:host.supervise(commands,root,env,root,stop,grace=2,restart_delay=.01,poll=.01,
                                   environments={name:host.process_environment(env,name) for name in commands})
                except Exception as error:failures.append(error)
            thread=threading.Thread(target=run);thread.start()
            try:
                until=time.monotonic()+8
                while time.monotonic()<until and not all(p.exists() and p.read_text() for p in seen.values()):time.sleep(.02)
                self.assertEqual(seen['worker'].read_text(),'synthetic-drafting')
                self.assertEqual(seen['api'].read_text(),'absent')
            finally:stop.set();thread.join(5)
            self.assertFalse(thread.is_alive());self.assertEqual(failures,[])

    def test_restart_budget_fails_closed_for_real_crash_loop(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(Exception, 'HOST_RESTART_BUDGET_EXHAUSTED'):
                host.supervise({'worker':[sys.executable,'-c','raise SystemExit(1)']},d,dict(os.environ),Path(d),threading.Event(),grace=1,restart_delay=.01,poll=.01)

    def test_forced_exit_is_not_reported_as_clean_drain(self):
        child=subprocess.Popen([sys.executable,'-c','import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);print("ready",flush=True);time.sleep(30)'],stdout=subprocess.PIPE,start_new_session=True)
        try:
            self.assertEqual(child.stdout.readline().strip(),b'ready')
            self.assertFalse(host.stop_group(child,grace=.05))
        finally:
            if child.poll() is None: os.killpg(child.pid,signal.SIGKILL)
            child.wait();child.stdout.close()


if __name__ == '__main__': unittest.main()
