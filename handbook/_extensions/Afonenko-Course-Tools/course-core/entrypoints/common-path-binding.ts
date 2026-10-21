/** Внутренний read-only мост Lua: не создаёт и не ослабляет native proof. */
import {commonPathDocument} from '../infrastructure/native-run.ts';
import {runCli} from './diagnostics.ts';
async function main(){
 let args=Deno.args;if(args[0]==='--')args=args.slice(1);
 if(args.length!==6||args[0]!=='--root'||args[2]!=='--source'||args[4]!=='--format')throw Error('Некорректный private common binding запрос');
 console.log(JSON.stringify(await commonPathDocument(args[1],args[3],args[5])));
}
if(import.meta.main)await runCli(main);
