import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';

// Същият API код се изпълнява върху SQLite с D1-съвместим адаптер.
// Замества се единствено платформената идентичност и достъпът до базата.
const root = new URL('../', import.meta.url);
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const moduleURL = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
const seedURL = moduleURL(compile(readFileSync(new URL('lib/seed.ts', root), 'utf8')));
globalThis.__rgTestEnv = { DB: null, RIVERGUARD_INGEST_KEY: 'test-only-key-with-at-least-32-characters' };
globalThis.__rgIdentity = { userId:'owner',displayName:'Тестов администратор',email:'owner@example.test',fullName:null };
process.env.NODE_ENV = 'production';
let source = readFileSync(new URL('lib/server.ts', root), 'utf8')
  .replace("import { env } from 'cloudflare:workers';", 'const env = globalThis.__rgTestEnv;')
  .replace("import { getChatGPTUser } from '../app/chatgpt-auth';", 'async function getChatGPTUser() { return globalThis.__rgIdentity; }')
  .replace("import { seedStations, seedRules } from './seed';", `const { seedStations, seedRules } = await import(${JSON.stringify(seedURL)});`)
  .replace("from './domain.mjs'", `from ${JSON.stringify(new URL('lib/domain.mjs', root).href)}`);
const { handleApi } = await import(moduleURL(compile(source)));
let sqlite;
class Statement {
  constructor(sql, args = []) { this.sql=sql; this.args=args; }
  bind(...args) { return new Statement(this.sql,args); }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args), success:true }; }
  async first() { return sqlite.prepare(this.sql).get(...this.args) || null; }
  async run() { const result=sqlite.prepare(this.sql).run(...this.args); return { success:true,meta:{ changes:Number(result.changes) } }; }
}
const db = { prepare: sql => new Statement(sql), async batch(statements) { sqlite.exec('BEGIN'); try { const result=[]; for (const s of statements) result.push(await s.run()); sqlite.exec('COMMIT'); return result; } catch(e) { sqlite.exec('ROLLBACK'); throw e; } } };
async function call(path, method='GET', body, headers={}) {
  const response=await handleApi(new Request(`https://riverguard.test/api/${path}`,{method,headers:{'content-type':'application/json',origin:'https://riverguard.test',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}));
  const value=(response.headers.get('content-type')||'').includes('json')?await response.json():await response.text();
  return {status:response.status,body:value,response};
}
async function switchIdentity(userId, role='municipal',municipality='Трявна') {
  globalThis.__rgIdentity={userId:'owner',displayName:'Тестов администратор',email:'owner@example.test',fullName:null};
  const result=await call('memberships','POST',{userId,name:userId,role,municipality});
  assert.equal(result.status,200,JSON.stringify(result.body));
  globalThis.__rgIdentity={userId,displayName:userId,email:`${userId}@example.test`,fullName:null};
}
beforeEach(async () => {
  sqlite?.close(); sqlite=new DatabaseSync(':memory:');
  for (const name of readdirSync(new URL('drizzle/',root)).filter(x=>x.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(`drizzle/${name}`,root),'utf8'));
  globalThis.__rgTestEnv.DB=db;
  globalThis.__rgIdentity={userId:'owner',displayName:'Тестов администратор',email:'owner@example.test',fullName:null};
  const result=await call('bootstrap');
  assert.equal(result.status,200,JSON.stringify(result.body));
});
after(()=>sqlite?.close());
test('API bootstrap създава начален администратор и постоянен набор',async()=>{const r=await call('bootstrap'); assert.equal(r.body.session.role,'admin'); assert.equal(r.body.stations.length,24); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memberships').get().n,1);});
test('производственият API отказва липсваща идентичност',async()=>{globalThis.__rgIdentity=null;const r=await call('bootstrap');assert.equal(r.status,401);});
test('нов посетител не получава администраторска роля',async()=>{globalThis.__rgIdentity={userId:'new',displayName:'Нов',email:'new@example.test'};const r=await call('bootstrap');assert.equal(r.body.session.role,'viewer');});
test('действителният общински оператор не може да симулира admin',async()=>{await switchIdentity('tryavna');const r=await call('session','POST',{role:'admin'});assert.equal(r.status,403);});
test('ролята се чете от сървърната сесия, без доверие в тялото',async()=>{await call('session','POST',{role:'viewer'});const r=await call('stations/TRV-001','PATCH',{role:'admin',notes:'злоупотреба'});assert.equal(r.status,403);assert.equal((await call('bootstrap')).body.session.role,'viewer');});
test('администраторът може да се върне от демонстрационен viewer',async()=>{await call('session','POST',{role:'viewer'});assert.equal((await call('session','POST',{role:'admin'})).status,200);assert.equal((await call('bootstrap')).body.session.role,'admin');});
test('общински API PATCH отказва чужда станция',async()=>{await switchIdentity('tryavna');assert.equal((await call('stations/PDV-001','PATCH',{notes:'x'})).status,403);assert.equal((await call('stations/TRV-001','PATCH',{notes:'Проверено'})).status,200);});
test('наблюдателят не създава вътрешни заявки',async()=>{await switchIdentity('observer','viewer',null);const r=await call('orders','POST',{municipality:'Трявна',productId:'rls500',quantity:1,reason:'Пример'});assert.equal(r.status,403);});
test('общинският експорт не съдържа чужди станции',async()=>{await switchIdentity('tryavna');const r=await call('export?format=json');assert.equal(r.status,200);assert.ok(r.body.readings.length>0);assert.ok(r.body.readings.every(x=>x.stationId.startsWith('TRV-')));assert.equal((await call('export?format=json&station=PDV-001')).status,403);});
test('националната справка включва всички станции в най-новите 10000',async()=>{const r=await call('measurements');assert.equal(r.status,200);assert.equal(r.body.readings.length,10000);assert.ok(r.body.truncated);assert.ok(new Set(r.body.readings.map(x=>x.stationId)).size>=22);});
test('offline историята е в избрания период и е валидна преди прекъсване',async()=>{const r=await call('measurements?station=PLV-001&from=2026-11-05T04:00:00Z&to=2026-11-05T08:00:00Z');assert.equal(r.status,200);assert.ok(r.body.readings.length>0);assert.ok(r.body.readings.every(x=>Date.parse(x.measuredAt)>=Date.parse('2026-11-05T04:00:00Z')&&Date.parse(x.measuredAt)<=Date.parse('2026-11-05T08:00:00Z')));assert.ok(r.body.readings.every(x=>x.quality==='valid'&&x.status!=='offline'));});
test('маркиране на симулирано измерване се вижда при quality филтър',async()=>{const r=await call('measurements?station=TRV-001');const row=r.body.readings[0];assert.equal((await call(`measurements/${row.id}/flag`,'POST',{quality:'suspect',reason:'Проверка'})).status,200);const filtered=await call('measurements?station=TRV-001&quality=suspect');assert.ok(filtered.body.readings.some(x=>x.id===row.id));});
test('суровата телеметрия се пази след маркиране и дубликат се отказва',async()=>{const input={id:'raw-test-1',stationId:'TRV-001',measuredAt:new Date().toISOString(),level:1.3,temperature:10,rain:0,rainPeriodMinutes:60,battery:88,signal:80};const headers={authorization:`Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}`};assert.equal((await call('ingest','POST',input,headers)).status,201);assert.equal((await call('ingest','POST',input,headers)).status,409);assert.equal((await call('measurements/raw-test-1/flag','POST',{quality:'suspect',reason:'Съпоставка'})).status,200);const raw=JSON.parse(sqlite.prepare('SELECT data FROM raw_measurements WHERE id=?').get('raw-test-1').data);assert.equal(raw.quality,'valid');assert.equal(raw.level,1.3);assert.equal((await call('measurements?station=TRV-001&quality=suspect')).body.readings[0].quality,'suspect');});
test('ingest не приема непознат bearer ключ',async()=>{const r=await call('ingest','POST',{stationId:'TRV-001'},{authorization:'Bearer invalid'});assert.equal(r.status,401);});
test('съгласуването и мястото се одобряват в една транзакция',async()=>{const r=await call('approvals/APR-DEMO-001','PATCH',{status:'approved',expert:'Експерт',municipalReference:'Решение 1',regime:'Проверен',documentReference:'Документ 1'});assert.equal(r.status,200,JSON.stringify(r.body));const state=(await call('bootstrap')).body;assert.equal(state.stations.find(x=>x.id==='TRV-001').locationStatus,'approved');assert.ok(state.audit.some(x=>x.action==='Одобрено местоположение'));});
test('старо съгласуване не одобрява променени координати',async()=>{await call('approvals/APR-DEMO-001','PATCH',{status:'approved',expert:'Експерт',municipalReference:'Решение 1',regime:'Проверен',documentReference:'Документ 1'});assert.equal((await call('stations/TRV-001','PATCH',{lat:42.86})).status,200);assert.equal((await call('approvals/APR-DEMO-001','PATCH',{status:'approved'})).status,409);assert.equal((await call('bootstrap')).body.stations.find(x=>x.id==='TRV-001').locationStatus,'proposed');});
test('общинско одобрение на заявка се отказва',async()=>{await switchIdentity('tryavna');assert.equal((await call('orders/ORD-DEMO-001','PATCH',{status:'approved'})).status,403);});
test('невалиден HTTP метод не заобикаля договорения маршрут',async()=>{assert.equal((await call('orders/ORD-DEMO-001','POST',{status:'approved'})).status,405);});
test('обученията позволяват само регистрирани идентификатори',async()=>{await switchIdentity('observer','viewer',null);assert.equal((await call('trainings/TR-01/complete','POST',{})).status,200);assert.equal((await call('trainings/fake/complete','POST',{})).status,400);assert.deepEqual((await call('bootstrap')).body.trainingCompletions,['TR-01']);});
test('повторен bootstrap не дублира сигналите',async()=>{const a=(await call('bootstrap')).body.alerts;const b=(await call('bootstrap')).body.alerts;assert.deepEqual(a.map(x=>x.id).sort(),b.map(x=>x.id).sort());});
test('повторна опасност след нормализиране създава нов епизод',async()=>{const makeDue=()=>{const row=sqlite.prepare("SELECT data FROM records WHERE key='rule:threshold'").get();const value=JSON.parse(row.data);value.lastRun=null;sqlite.prepare("UPDATE records SET data=? WHERE key='rule:threshold'").run(JSON.stringify(value));};await call('stations/TRV-001','PATCH',{baseLevel:2});makeDue();const first=(await call('bootstrap')).body.alerts.filter(x=>x.stationId==='TRV-001'&&x.id.includes('threshold'));assert.equal(first.length,1);await call('stations/TRV-001','PATCH',{baseLevel:1});makeDue();await call('bootstrap');await call('stations/TRV-001','PATCH',{baseLevel:2});makeDue();const second=(await call('bootstrap')).body.alerts.filter(x=>x.stationId==='TRV-001'&&x.id.includes('threshold'));assert.equal(second.length,2);});
test('правилата спазват конфигурирания интервал',async()=>{await call('stations/TRV-001','PATCH',{baseLevel:2});const recent=(await call('bootstrap')).body.alerts.filter(x=>x.stationId==='TRV-001'&&x.id.includes('threshold'));assert.equal(recent.length,0);const row=sqlite.prepare("SELECT data FROM records WHERE key='rule:threshold'").get();const rule=JSON.parse(row.data);rule.lastRun=null;sqlite.prepare("UPDATE records SET data=? WHERE key='rule:threshold'").run(JSON.stringify(rule));const due=(await call('bootstrap')).body.alerts.filter(x=>x.stationId==='TRV-001'&&x.id.includes('threshold'));assert.equal(due.length,1);});
test('новата телеметрия задейства правилата без отворен екран',async()=>{const row=sqlite.prepare("SELECT data FROM records WHERE key='rule:threshold'").get();const rule=JSON.parse(row.data);rule.lastRun=null;sqlite.prepare("UPDATE records SET data=? WHERE key='rule:threshold'").run(JSON.stringify(rule));const r=await call('ingest','POST',{id:'closed-browser-1',stationId:'TRV-001',measuredAt:new Date().toISOString(),level:3,temperature:10,rain:null,battery:88,signal:80},{authorization:`Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}`});assert.equal(r.status,201);const alerts=sqlite.prepare("SELECT data FROM records WHERE kind='alert' AND station_id='TRV-001'").all().map(x=>JSON.parse(x.data));assert.ok(alerts.some(x=>x.severity==='critical'));});
test('липсващ ingest ключ връща изрично неконфигурирана услуга',async()=>{const key=globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY;delete globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY;try {assert.equal((await call('ingest','POST',{})).status,503);}finally {globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY=key;}});
test('стара версия не презаписва чужда промяна по станция',async()=>{const station=(await call('bootstrap')).body.stations.find(x=>x.id==='TRV-001');assert.equal((await call('stations/TRV-001','PATCH',{version:station.version,notes:'Първа промяна'})).status,200);assert.equal((await call('stations/TRV-001','PATCH',{version:station.version,notes:'Стара промяна'})).status,409);assert.equal((await call('bootstrap')).body.stations.find(x=>x.id==='TRV-001').notes,'Първа промяна');});
test('JSON експортът отбелязва ограничението и в HTTP заглавката',async()=>{const r=await call('export?format=json');assert.equal(r.status,200);assert.equal(r.body.truncated,true);assert.equal(r.response.headers.get('x-riverguard-truncated'),'true');});
test('реален запис пази snapshot след преименуване и преместване на станцията',async()=>{const input={id:'snapshot-test-1',stationId:'TRV-001',measuredAt:new Date().toISOString(),level:1.3,levelBackup:1.305,temperature:10,rain:null,battery:90,signal:80};const headers={authorization:`Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}`};assert.equal((await call('ingest','POST',input,headers)).status,201);assert.equal((await call('stations/TRV-001','PATCH',{name:'Преименувана станция',lat:42.86,lng:25.5,municipality:'Пловдив',oblast:'Пловдив'})).status,200);const csv=await call('export?format=csv&station=TRV-001');assert.equal(csv.status,200);assert.ok(csv.body.includes('"Трявна · горен участък"'));assert.ok(csv.body.includes('"42.8556"'));assert.ok(!csv.body.includes('Преименувана станция'));assert.ok(csv.body.includes('"Резервно ниво PLS m"'));const json=await call('export?format=json&station=TRV-001');const reading=json.body.readings[0];assert.equal(reading.stationSnapshot.municipality,'Трявна');assert.equal(reading.stationSnapshot.stationVersion,1);assert.equal(reading.levelBackup,1.305);assert.equal(reading.levelDelta,0.005);});
test('историческата община управлява експорта след преместване, без изтичане към новата',async()=>{const input={id:'historical-scope-1',stationId:'TRV-001',measuredAt:new Date().toISOString(),level:1.3,levelBackup:1.302,temperature:10,rain:null,battery:90,signal:80};assert.equal((await call('ingest','POST',input,{authorization:`Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}`})).status,201);assert.equal((await call('stations/TRV-001','PATCH',{municipality:'Пловдив',oblast:'Пловдив'})).status,200);await switchIdentity('tryavna-historical');const old=await call('export?format=json&station=TRV-001');assert.equal(old.status,200);assert.equal(old.body.readings.length,1);assert.equal(old.body.readings[0].stationSnapshot.municipality,'Трявна');await switchIdentity('plovdiv-new','municipal','Пловдив');const newer=await call('export?format=json&station=TRV-001');assert.equal(newer.status,200);assert.equal(newer.body.readings.length,0);assert.equal((await call('measurements/historical-scope-1/flag','POST',{quality:'suspect',reason:'Чужд исторически обхват'})).status,403);});
test('маркиране като съмнително изключва delta, без да променя суровите канали',async()=>{const input={id:'quality-backup-1',stationId:'TRV-001',measuredAt:new Date().toISOString(),level:1.3,levelBackup:1.305,temperature:10,rain:null,battery:90,signal:80};await call('ingest','POST',input,{authorization:`Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}`});const flag=await call('measurements/quality-backup-1/flag','POST',{quality:'suspect',reason:'Проверка на разликата'});assert.equal(flag.status,200);assert.equal(flag.body.levelDelta,null);const rows=(await call('measurements?station=TRV-001')).body.readings;assert.equal(rows[0].levelDelta,null);const raw=JSON.parse(sqlite.prepare('SELECT data FROM raw_measurements WHERE id=?').get(input.id).data);assert.equal(raw.level,1.3);assert.equal(raw.levelBackup,1.305);assert.equal(raw.levelDelta,0.005);});

function qualityRuleDue() {
  const row = sqlite.prepare("SELECT data FROM records WHERE key='rule:quality'").get();
  const rule = JSON.parse(row.data);
  rule.lastRun = null;
  sqlite.prepare("UPDATE records SET data=? WHERE key='rule:quality'").run(JSON.stringify(rule));
}
function qualityAlerts(stationId) {
  return sqlite.prepare("SELECT data FROM records WHERE kind='alert' AND station_id=?").all(stationId).map(row => JSON.parse(row.data)).filter(alert => alert.id.includes('-quality-'));
}
async function qualityTelemetry(id, stationId, fields = {}) {
  return call('ingest', 'POST', { id, stationId, measuredAt: new Date().toISOString(), level: 1.3, levelBackup: 1.302, temperature: 10, rain: null, battery: 90, signal: 80, ...fields }, { authorization: `Bearer ${globalThis.__rgTestEnv.RIVERGUARD_INGEST_KEY}` });
}

test('правилото за качество сигнализира съмнителен и липсващ основен или регистриран резервен канал', async () => {
  const cases = [
    { stationId: 'TRV-001', quality: 'suspect', levelBackupQuality: 'valid' },
    { stationId: 'TRV-002', quality: 'missing', levelBackupQuality: 'valid' },
    { stationId: 'TRV-003', quality: 'valid', levelBackupQuality: 'suspect' },
    { stationId: 'GAB-001', quality: 'valid', levelBackupQuality: 'missing', levelBackup: null },
  ];
  for (const [index, fields] of cases.entries()) {
    qualityRuleDue();
    assert.equal((await qualityTelemetry(`quality-channel-${index}`, fields.stationId, fields)).status, 201);
    const alerts = qualityAlerts(fields.stationId);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].severity, 'warning');
    const raw = JSON.parse(sqlite.prepare('SELECT data FROM raw_measurements WHERE id=?').get(`quality-channel-${index}`).data);
    assert.equal(raw.quality, fields.quality);
    assert.equal(raw.level, 1.3);
  }
  qualityRuleDue(); await call('bootstrap');
  for (const item of cases) assert.equal(qualityAlerts(item.stationId).length, 1);
});

test('учебният праг за качество има точна граница и нов епизод след нормализиране', async () => {
  const baseTime = Date.now();
  const samples = [
    { backup: 1.35, expected: 0 },
    { backup: 1.351, expected: 1 },
    { backup: 1.3, expected: 1 },
    { backup: 1.24, expected: 2 },
  ];
  for (const [index, sample] of samples.entries()) {
    qualityRuleDue();
    assert.equal((await qualityTelemetry(`quality-delta-${index}`, 'TRV-001', { measuredAt: new Date(baseTime + index * 1000).toISOString(), levelBackup: sample.backup })).status, 201);
    assert.equal(qualityAlerts('TRV-001').length, sample.expected);
    qualityRuleDue(); await call('bootstrap');
    assert.equal(qualityAlerts('TRV-001').length, sample.expected);
  }
  assert.ok(qualityAlerts('TRV-001').every(alert => alert.title.includes('учебния праг 0,05 m')));
  const raw = JSON.parse(sqlite.prepare('SELECT data FROM raw_measurements WHERE id=?').get('quality-delta-3').data);
  assert.equal(raw.level, 1.3); assert.equal(raw.levelBackup, 1.24); assert.equal(raw.levelDelta, -0.06);
});

test('превключвателят и интервалът управляват сигнала за качество, без да изключват ingest валидацията', async () => {
  assert.equal((await qualityTelemetry('quality-interval-1', 'TRV-001', { quality: 'suspect' })).status, 201);
  assert.equal(qualityAlerts('TRV-001').length, 0);
  qualityRuleDue();
  assert.equal((await call('rules/quality', 'PATCH', { enabled: false })).status, 200);
  await call('bootstrap');
  assert.equal(qualityAlerts('TRV-001').length, 0);
  assert.equal((await qualityTelemetry('quality-invalid-1', 'TRV-001', { level: 'нечислова стойност' })).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM raw_measurements WHERE id=?').get('quality-invalid-1').n, 0);
  assert.equal((await call('rules/quality', 'PATCH', { enabled: true })).status, 200);
  await call('bootstrap');
  assert.equal(qualityAlerts('TRV-001').length, 1);
});
