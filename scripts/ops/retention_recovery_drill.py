"""Disposable PostgreSQL dump/restore proof. No provider or managed DB credentials."""
from pathlib import Path
import json,os,shutil,socket,subprocess,tempfile,uuid,sys
sys.stdout.reconfigure(encoding='utf-8')

repo=Path(__file__).resolve().parents[2]
parent=Path(os.environ.get('VALO_RETENTION_TEST_PARENT',tempfile.gettempdir())).resolve()
run=parent/('valo-retention-recovery-'+str(uuid.uuid4()));run.mkdir(mode=0o700)
data=run/'data';env={k:v for k,v in os.environ.items() if k.lower() in ('path','systemroot','windir','temp','tmp')}
with socket.socket() as listener:listener.bind(('127.0.0.1',0));port=listener.getsockname()[1]
report={'passed':False,'scope':'disposable synthetic local PostgreSQL dump and restore','productionCreated':False}
started=False
def command(name,args,values=env,cwd=repo,timeout=120):
 with (run/(name+'.log')).open('wb') as output:
  result=subprocess.run(args,cwd=cwd,env=values,stdout=output,stderr=subprocess.STDOUT,timeout=timeout,
                        **({'creationflags':subprocess.CREATE_NO_WINDOW} if os.name=='nt' else {}))
 if result.returncode:raise RuntimeError(name+'_FAILED')
 return (run/(name+'.log')).read_text(encoding='utf-8')
try:
 command('initdb',['initdb','-D',str(data),'-U','valo_retention_test','--auth=trust','--no-locale','-E','UTF8'])
 with (data/'postgresql.conf').open('a') as file:file.write("\nlisten_addresses='127.0.0.1'\nport="+str(port)+"\n")
 command('start',['pg_ctl','-D',str(data),'-l',str(run/'postgres.log'),'-w','start']);started=True
 values={**env,'DATABASE_URL':f'postgresql://valo_retention_test@127.0.0.1:{port}/postgres','NODE_ENV':'development',
  'VALO_RETENTION_RECOVERY':'synthetic-local-only','VALO_ISOLATED_RECOVERY':'synthetic-local-only',
  'VALO_RETENTION_RECOVERY_ROOT':str(run),'VALO_RUN_RETENTION_RECOVERY':'synthetic-isolated-only',
  'SESSION_SECRET':'synthetic-retention-recovery-session-key-never-production',
  'VALO_RECOVERY_PG_BIN':str(Path(shutil.which('pg_dump')).parent)}
 if os.environ.get('ESBUILD_BINARY_PATH'):values['ESBUILD_BINARY_PATH']=os.environ['ESBUILD_BINARY_PATH']
 output=command('retention',['node','--import','tsx','--test',str(repo/'scripts/ops/retention_restore.integration.mjs')],values,repo/'artifacts/api-server',180)
 report.update(passed=True,testOutput=output)
except Exception as error:
 report['errorCode']=str(error);report['logDirectory']=str(run)
 if (run/'retention.log').exists():print((run/'retention.log').read_text(encoding='utf-8'))
finally:
 if started:command('stop',['pg_ctl','-D',str(data),'-m','fast','-w','stop'])
 report['clusterStopped']=True
 # Delete only our verified newly created child, after PostgreSQL has stopped.
 assert run.parent==parent and run.name.startswith('valo-retention-recovery-') and not run.is_symlink()
 if report['passed']:shutil.rmtree(run);report['disposableDataRemoved']=True
 else:
  for name in ('data','objects'):
   target=run/name
   if target.exists():assert target.resolve().parent==run and not target.is_symlink();shutil.rmtree(target)
 out=repo/'generated-artifacts/valo-retention-recovery';out.mkdir(parents=True,exist_ok=True)
 (out/'report.json').write_text(json.dumps(report,indent=2),encoding='utf-8');print(json.dumps(report))
raise SystemExit(0 if report['passed'] else 1)
