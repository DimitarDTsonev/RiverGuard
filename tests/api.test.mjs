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
  .replace("from './domain.mjs'", `from ${JSON.stringify(new URL('lib/domain.mjs', root).href)}`)
  .replace("from './station-metadata.mjs'", `from ${JSON.stringify(new URL('lib/station-metadata.mjs', root).href)}`);
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
test('API bootstrap създава начален администратор и 26 станции, от които 5 в Трявна',async()=>{const r=await call('bootstrap'); assert.equal(r.body.session.role,'admin'); assert.equal(r.body.stations.length,26); assert.deepEqual(r.body.stations.filter(s=>s.municipality==='Трявна').map(s=>s.id),['TRV-001','TRV-002','TRV-003','TRV-004','TRV-005']); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM memberships').get().n,1);});

const tryavnaExpansionKey = 'seed_tryavna_five_stations_v1';
const newTryavnaIds = ['TRV-004', 'TRV-005'];
function restoreThreeStationPilot() {
  sqlite.prepare('DELETE FROM app_settings WHERE key=?').run(tryavnaExpansionKey);
  sqlite.prepare("DELETE FROM records WHERE key IN ('station:TRV-004','station:TRV-005')").run();
  assert.ok(sqlite.prepare("SELECT value FROM app_settings WHERE key='seed_v1'").get());
}

test('двата нови пункта имат независими канали за ниво и непотвърдени работни профили', async () => {
  const state = (await call('bootstrap')).body;
  for (const id of newTryavnaIds) {
    const station = state.stations.find(s => s.id === id);
    assert.equal(station.municipality, 'Трявна');
    assert.equal(station.river, 'Тревненска');
    assert.equal(station.oblast, 'Габрово');
    assert.deepEqual(station.sensors, ['rls500', 'pls500']);
    assert.equal(station.interval, 60);
    assert.equal(station.transmitInterval, 60);
    assert.equal(station.locationStatus, 'proposed');
    assert.equal(station.riverSection.status, 'draft');
    assert.equal(station.riverSection.terrain, 'unknown');
    assert.equal(station.riverSection.position, 'unknown');
    for (const key of ['channel', 'flowRegime', 'floodRisks', 'monitoringFocus']) assert.ok(station.riverSection[key]);
    for (const key of ['reviewedBy', 'reviewedAt', 'sourceTitle', 'sourceUrl', 'reference', 'waterBodyCode', 'typologyCode']) assert.equal(station.riverSection[key], '');
    assert.equal(station.current.source, 'simulated');
    assert.equal(typeof station.current.level, 'number');
    assert.equal(typeof station.current.levelBackup, 'number');
    assert.equal(station.current.rain, null);
    assert.equal(station.current.discharge, null);
    const history = await call(`measurements?station=${id}`);
    assert.equal(history.status, 200);
    assert.ok(history.body.readings.length > 0);
    assert.ok(history.body.readings.every(row => row.stationId === id && row.source === 'simulated' && typeof row.level === 'number' && typeof row.levelBackup === 'number'));
  }
});

test('обновяването на съществуващия пилот добавя само двата пункта и пази данни, версии и права', async () => {
  assert.equal((await call('stations/TRV-001', 'PATCH', { notes: 'Запазена общинска конфигурация', interval: 120, transmitInterval: 180 })).status, 200);
  assert.equal((await call('memberships', 'POST', { userId: 'existing-operator', name: 'Общински оператор', role: 'municipal', municipality: 'Трявна' })).status, 200);
  assert.equal((await qualityTelemetry('before-expansion', 'TRV-001')).status, 201);
  restoreThreeStationPilot();
  const oldStations = sqlite.prepare("SELECT * FROM records WHERE kind='station' ORDER BY key").all();
  const oldMemberships = sqlite.prepare('SELECT * FROM memberships ORDER BY user_id').all();
  const oldReadings = sqlite.prepare('SELECT * FROM raw_measurements ORDER BY id').all();
  const firstSeed = sqlite.prepare("SELECT * FROM app_settings WHERE key IN ('seed_v1','initial_owner') ORDER BY key").all();
  assert.equal(oldStations.length, 24);
  const result = await call('bootstrap');
  assert.equal(result.status, 200);
  assert.equal(result.body.stations.length, 26);
  assert.equal(result.body.stations.filter(s => s.municipality === 'Трявна').length, 5);
  assert.deepEqual(sqlite.prepare("SELECT * FROM records WHERE kind='station' AND record_id NOT IN ('TRV-004','TRV-005') ORDER BY key").all(), oldStations);
  assert.deepEqual(sqlite.prepare('SELECT * FROM memberships ORDER BY user_id').all(), oldMemberships);
  assert.deepEqual(sqlite.prepare('SELECT * FROM raw_measurements ORDER BY id').all(), oldReadings);
  assert.deepEqual(sqlite.prepare("SELECT * FROM app_settings WHERE key IN ('seed_v1','initial_owner') ORDER BY key").all(), firstSeed);
  assert.ok(sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey));
});

test('повторното зареждане не дублира и не връща редактирани допълнителни станции към началните стойности', async () => {
  assert.equal((await call('stations/TRV-004', 'PATCH', { notes: 'Общинска редакция след добавяне', interval: 120, transmitInterval: 120, riverSection: { channel: 'Описание от работен оглед' } })).status, 200);
  const saved = sqlite.prepare("SELECT * FROM records WHERE key='station:TRV-004'").get();
  const marker = sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey);
  for (let i = 0; i < 2; i++) {
    const result = await call('bootstrap');
    assert.equal(result.status, 200);
    assert.equal(result.body.stations.length, 26);
  }
  assert.deepEqual(sqlite.prepare("SELECT * FROM records WHERE key='station:TRV-004'").get(), saved);
  assert.deepEqual(sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey), marker);
});

test('завършеното допълване не възстановява премахнат след него демонстрационен пункт', async () => {
  sqlite.prepare("DELETE FROM records WHERE key='station:TRV-005'").run();
  const result = await call('bootstrap');
  assert.equal(result.status, 200);
  assert.equal(result.body.stations.length, 25);
  assert.ok(!result.body.stations.some(station => station.id === 'TRV-005'));
  assert.ok(sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey));
});

test('съществуващ запис със същия идентификатор се запазва при допълването', async () => {
  assert.equal((await call('stations/TRV-004', 'PATCH', { name: 'Съществуващ общински пункт', notes: 'Да не се заменя', lat: 42.861, riverSection: { name: 'Самостоятелен работен профил', channel: 'Предварително въведен профил' } })).status, 200);
  const saved = sqlite.prepare("SELECT * FROM records WHERE key='station:TRV-004'").get();
  sqlite.prepare('DELETE FROM app_settings WHERE key=?').run(tryavnaExpansionKey);
  sqlite.prepare("DELETE FROM records WHERE key='station:TRV-005'").run();
  const result = await call('bootstrap');
  assert.equal(result.status, 200);
  assert.equal(result.body.stations.length, 26);
  assert.deepEqual(sqlite.prepare("SELECT * FROM records WHERE key='station:TRV-004'").get(), saved);
  assert.ok(result.body.stations.some(station => station.id === 'TRV-005'));
});

test('грешка при втория нов пункт отменя целия batch и позволява безопасно повторение', async () => {
  restoreThreeStationPilot();
  sqlite.exec("CREATE TRIGGER reject_second_addition BEFORE INSERT ON records WHEN NEW.key='station:TRV-005' BEGIN SELECT RAISE(ABORT, 'test upgrade failure'); END;");
  assert.equal((await call('bootstrap')).status, 500);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM records WHERE kind='station'").get().n, 24);
  assert.equal(sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey), undefined);
  sqlite.exec('DROP TRIGGER reject_second_addition');
  const result = await call('bootstrap');
  assert.equal(result.status, 200);
  assert.equal(result.body.stations.length, 26);
  assert.ok(sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(tryavnaExpansionKey));
});

test('новите станции се управляват и експортират само в съответния общински обхват', async () => {
  await switchIdentity('tryavna-expanded');
  for (const id of newTryavnaIds) assert.equal((await call(`stations/${id}`, 'PATCH', { notes: 'Общинска проверка на нов пункт' })).status, 200);
  const exported = await call('export?format=json');
  assert.equal(exported.status, 200);
  assert.deepEqual([...new Set(exported.body.readings.map(row => row.stationId))].sort(), ['TRV-001','TRV-002','TRV-003','TRV-004','TRV-005']);
  await switchIdentity('gabrovo-expanded', 'municipal', 'Габрово');
  for (const id of newTryavnaIds) {
    assert.equal((await call(`stations/${id}`, 'PATCH', { notes: 'Чужда община' })).status, 403);
    assert.equal((await call(`export?format=json&station=${id}`)).status, 403);
  }
});

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

const sectionVerification = {status:'verified',sourceTitle:'Проверено хидроложко становище',reference:'RG-SECTION-12',reviewedBy:'Отговорен хидролог',reviewedAt:'2026-11-01'};
const storedStation = id => JSON.parse(sqlite.prepare('SELECT data FROM records WHERE key=?').get(`station:${id}`).data);
const stationFromApi = async id => (await call('bootstrap')).body.stations.find(value => value.id === id);

test('API обогатява старите станции при четене, без да мигрира или презаписва D1', async () => {
  const original = sqlite.prepare("SELECT data,version FROM records WHERE key='station:TRV-001'").get();
  assert.equal(JSON.parse(original.data).riverSection, undefined);
  const first = await stationFromApi('TRV-001');
  const second = await stationFromApi('TRV-001');
  assert.equal(first.riverSection.status, 'draft');
  assert.ok(first.riverSection.channel.length > 0);
  assert.deepEqual(first.riverSection, second.riverSection);
  assert.deepEqual(sqlite.prepare("SELECT data,version FROM records WHERE key='station:TRV-001'").get(), original);
});

test('записът на речния профил оцелява след повторно четене и частични промени', async () => {
  const initial = await stationFromApi('TRV-001');
  const patch = await call('stations/TRV-001','PATCH',{version:initial.version,riverSection:{channel:'Корито от теренен оглед',flowRegime:'Локален сезонен режим'}});
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  assert.equal(patch.body.version, initial.version + 1);
  assert.equal((await call('stations/TRV-001','PATCH',{version:patch.body.version,riverSection:{monitoringFocus:'Контрол при мост'}})).status, 200);
  assert.equal((await call('stations/TRV-001','PATCH',{notes:'Проверено захранване'})).status, 200);
  const read = await stationFromApi('TRV-001');
  assert.equal(read.riverSection.channel, 'Корито от теренен оглед');
  assert.equal(read.riverSection.flowRegime, 'Локален сезонен режим');
  assert.equal(read.riverSection.monitoringFocus, 'Контрол при мост');
  assert.deepEqual(read.riverSection, storedStation('TRV-001').riverSection);
  assert.ok((await call('bootstrap')).body.audit.some(entry => entry.entity === 'station:TRV-001' && entry.details.includes('речен участък: обновен профил')));
});

test('общинската чернова съхранява проверяващ и дата без автоматично потвърждение', async () => {
  await switchIdentity('section-draft-editor');
  const saved = await call('stations/TRV-001','PATCH',{riverSection:{reviewedBy:'Общински хидролог',reviewedAt:'2026-11-01'}});
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal((await call('stations/TRV-001','PATCH',{riverSection:{channel:'Допълнение към черновата'}})).status, 200);
  const read = await stationFromApi('TRV-001');
  assert.equal(read.riverSection.status, 'draft');
  assert.equal(read.riverSection.reviewedBy, 'Общински хидролог');
  assert.equal(read.riverSection.reviewedAt, '2026-11-01');
  assert.deepEqual(read.riverSection, storedStation('TRV-001').riverSection);
});

test('регистриран EXO2 се запазва в инвентара на станцията', async () => {
  const saved = await call('stations/TRV-001','PATCH',{sensors:['rls500','pls500','exo2']});
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.deepEqual((await stationFromApi('TRV-001')).sensors, ['rls500','pls500','exo2']);
});

test('общинските права ограничават и вложения речен профил до собствената община', async () => {
  await switchIdentity('tryavna-section');
  const foreign = storedStation('YAM-001');
  assert.equal((await call('stations/YAM-001','PATCH',{riverSection:{channel:'Чужда промяна'}})).status, 403);
  assert.deepEqual(storedStation('YAM-001'), foreign);
  assert.equal((await call('stations/TRV-001','PATCH',{riverSection:{channel:'Общински теренен запис'}})).status, 200);
  assert.equal((await stationFromApi('TRV-001')).riverSection.channel, 'Общински теренен запис');
  assert.equal((await call('stations/TRV-001','PATCH',{riverSection:sectionVerification})).status, 403);
});

test('наблюдателят чете речния профил, но не може да го променя', async () => {
  await switchIdentity('section-viewer','viewer',null);
  assert.equal((await stationFromApi('YAM-001')).riverSection.terrain, 'lowland');
  assert.equal((await call('stations/YAM-001','PATCH',{riverSection:{terrain:'mountain'}})).status, 403);
});

test('версията на станцията предотвратява загуба на чужда промяна по речния профил', async () => {
  const initial = await stationFromApi('TRV-001');
  assert.equal((await call('stations/TRV-001','PATCH',{version:initial.version,riverSection:{channel:'По-нов теренен запис'}})).status, 200);
  assert.equal((await call('stations/TRV-001','PATCH',{version:initial.version,riverSection:{channel:'Остаряла форма'}})).status, 409);
  assert.equal((await stationFromApi('TRV-001')).riverSection.channel, 'По-нов теренен запис');
});

test('потвърждаването на профил не одобрява място за монтаж и се обезсилва при редакция', async () => {
  const incomplete = await call('stations/TRV-001','PATCH',{riverSection:{status:'verified'}});
  assert.equal(incomplete.status, 400);
  const confirmed = await call('stations/TRV-001','PATCH',{riverSection:sectionVerification});
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.riverSection.status, 'verified');
  assert.equal(confirmed.body.locationStatus, 'proposed');
  assert.equal((await call('stations/TRV-001','PATCH',{notes:'Външна проверка на шкафа'})).status, 200);
  assert.equal((await stationFromApi('TRV-001')).riverSection.status, 'verified');
  await switchIdentity('section-editor');
  const changed = await call('stations/TRV-001','PATCH',{riverSection:{channel:'Променено корито'}});
  assert.equal(changed.status, 200);
  assert.equal(changed.body.riverSection.status, 'draft');
  assert.equal(changed.body.riverSection.reviewedBy, '');
  assert.equal(changed.body.riverSection.reviewedAt, '');
  assert.equal((await stationFromApi('TRV-001')).riverSection.status, 'draft');
});

test('местене на станция нулира стария профил и read fallback не го възстановява', async () => {
  const confirmed = await call('stations/TRV-001','PATCH',{riverSection:sectionVerification});
  assert.equal(confirmed.status, 200);
  const moved = await call('stations/TRV-001','PATCH',{version:confirmed.body.version,lat:42.86,riverSection:confirmed.body.riverSection});
  assert.equal(moved.status, 200);
  assert.equal(moved.body.riverSection.status, 'draft');
  assert.equal(moved.body.riverSection.terrain, 'unknown');
  assert.equal(moved.body.riverSection.channel, '');
  assert.equal(moved.body.riverSection.reference, '');
  assert.deepEqual((await stationFromApi('TRV-001')).riverSection, moved.body.riverSection);
  assert.equal((await call('stations/TRV-001','PATCH',{lat:42.8556})).status, 200);
  assert.equal((await stationFromApi('TRV-001')).riverSection.channel, '');
});

test('местене с ново описание запазва само новите полета и изисква отделна проверка', async () => {
  const confirmed = await call('stations/TRV-001','PATCH',{riverSection:sectionVerification});
  assert.equal(confirmed.status, 200);
  const moved = await call('stations/TRV-001','PATCH',{
    version:confirmed.body.version, lat:42.86,
    riverSection:{ ...confirmed.body.riverSection, name:'Нов пункт при същата река', channel:'Ново теренно описание' },
  });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const read = await stationFromApi('TRV-001');
  assert.equal(read.riverSection.name, 'Нов пункт при същата река');
  assert.equal(read.riverSection.channel, 'Ново теренно описание');
  assert.equal(read.riverSection.status, 'draft');
  assert.equal(read.riverSection.terrain, 'unknown');
  assert.equal(read.riverSection.flowRegime, '');
  assert.equal(read.riverSection.sourceTitle, '');
  assert.equal(read.riverSection.reference, '');
  assert.equal(read.riverSection.reviewedBy, '');
  assert.equal(read.riverSection.reviewedAt, '');
  assert.deepEqual(read.riverSection, storedStation('TRV-001').riverSection);
});

test('две станции на една река съхраняват независими характеристики на участъците', async () => {
  assert.equal((await call('stations/SLV-001','PATCH',{riverSection:{name:'Участък при Сливен',terrain:'foothill'}})).status, 200);
  assert.equal((await call('stations/YAM-001','PATCH',{riverSection:{name:'Участък при Ямбол',terrain:'lowland'}})).status, 200);
  const stations = (await call('bootstrap')).body.stations;
  const sliven = stations.find(station => station.id === 'SLV-001');
  const yambol = stations.find(station => station.id === 'YAM-001');
  assert.equal(sliven.river, yambol.river);
  assert.equal(sliven.riverSection.terrain, 'foothill');
  assert.equal(yambol.riverSection.terrain, 'lowland');
  assert.notEqual(sliven.riverSection.name, yambol.riverSection.name);
});

test('невалиден вложен профил се отхвърля атомарно без промяна на версията или данните', async () => {
  const original = sqlite.prepare("SELECT data,version FROM records WHERE key='station:TRV-001'").get();
  for (const riverSection of [null, [], {sourceUrl:'javascript:alert(1)'}, {position:null}, {terrain:'unsupported'}, {reviewedAt:'2026-02-30'}, {unrecognised:'data'}]) {
    const result = await call('stations/TRV-001','PATCH',{notes:'Не трябва да се запише',riverSection});
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.deepEqual(sqlite.prepare("SELECT data,version FROM records WHERE key='station:TRV-001'").get(), original);
  }
});
