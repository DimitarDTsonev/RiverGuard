import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../app/chatgpt-auth';
import { seedStations, seedRules } from './seed';
import { enrichStationMetadata } from './station-metadata.mjs';
import type { Session, Role, Station, Reading, Alert, Order, Ticket, Approval, Rule, Bootstrap, Membership } from './types';
import { ApiError, ROLES, assertRole, assertScope, assertSameOrigin, requiredText, numberIn, oneOf, canExport, validateStation, validateOrder, validateApproval, simulatedReading, alertKey, parsePeriod, stationMatches, csvCell, validateIngest, levelDifference } from './domain.mjs';

type RecordRow = { key: string; data: string; version: number; municipality: string | null };
type MemberRow = { user_id: string; name: string; role: Role; municipality: string | null };
const nowISO = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
function withQuality(reading: Reading, quality = reading.quality): Reading {
  const levelBackup = reading.levelBackup ?? null;
  const levelBackupQuality = reading.levelBackupQuality ?? (levelBackup === null ? 'missing' : 'valid');
  return { ...reading, quality, levelBackup, levelBackupQuality, levelDelta: levelDifference(reading.level, levelBackup, quality, levelBackupQuality) };
}
const database = () => {
  if (!env.DB) throw new ApiError(503, 'Базата данни не е достъпна. Опитайте отново.');
  return env.DB;
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
async function bodyOf(request: Request): Promise<Record<string, any>> {
  if (Number(request.headers.get('content-length') || 0) > 65536) throw new ApiError(413, 'Заявката е прекалено голяма.');
  const text = await request.text();
  if (text.length > 65536) throw new ApiError(413, 'Заявката е прекалено голяма.');
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body;
  } catch { throw new ApiError(400, 'Невалидни JSON данни.'); }
}
async function records<T>(kind: string): Promise<T[]> {
  const result = await database().prepare('SELECT data, version FROM records WHERE kind = ? ORDER BY record_id').bind(kind).all<{ data: string; version: number }>();
  return result.results.map(row => {
    const value = JSON.parse(row.data);
    return kind === 'station' ? enrichStationMetadata({ ...value, version: row.version }) : value;
  });
}
async function record<T>(kind: string, id: string): Promise<{ value: T; version: number }> {
  const row = await database().prepare('SELECT data, version FROM records WHERE key = ?').bind(`${kind}:${id}`).first<RecordRow>();
  if (!row) throw new ApiError(404, 'Записът не е намерен.');
  const value = JSON.parse(row.data);
  return { value: kind === 'station' ? enrichStationMetadata(value) : value, version: row.version };
}
function auditStatement(session: Session, action: string, entity: string, details: string, municipality: string | null, conditional = false) {
  return database().prepare(`INSERT INTO audit_log (id, actor_id, actor, role, action, entity, details, municipality, created_at) SELECT ?,?,?,?,?,?,?,?,?${conditional ? ' WHERE changes() > 0' : ''}`)
    .bind(uid('AUD'), session.userId, session.name, session.role, action, entity, details, municipality, nowISO());
}
async function saveRecord(kind: string, value: any, session: Session, municipality: string | null, previousVersion?: number, details?: string) {
  const stamp = nowISO();
  const key = `${kind}:${value.id}`;
  const statement = previousVersion === undefined
    ? database().prepare('INSERT INTO records (key, kind, record_id, municipality, station_id, data, version, created_at, updated_at) VALUES (?,?,?,?,?,?,1,?,?)').bind(key, kind, value.id, municipality, value.stationId || null, JSON.stringify(value), stamp, stamp)
    : database().prepare('UPDATE records SET data = ?, municipality = ?, station_id = ?, version = version + 1, updated_at = ? WHERE key = ? AND version = ?').bind(JSON.stringify(value), municipality, value.stationId || null, stamp, key, previousVersion);
  try {
    const result = await database().batch([statement, auditStatement(session, previousVersion === undefined ? 'Създаване' : 'Промяна', key, details || value.name || value.subject || value.status || value.id, municipality, true)]);
    if (!result[0].meta.changes) throw new ApiError(409, 'Записът е променен междувременно. Презаредете данните.');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (String(error).includes('UNIQUE')) throw new ApiError(409, 'Вече има запис с този идентификатор.');
    throw error;
  }
  return value;
}


async function saveApprovedApproval(value: any, previousVersion: number | undefined, station: { value: Station; version: number }, session: Session) {
  const stamp = nowISO();
  const revision = crypto.randomUUID();
  const stored = { ...value, approvalRevision: revision };
  const key = `approval:${value.id}`;
  const stationKey = `station:${station.value.id}`;
  const data = JSON.stringify(stored);
  const mutation = previousVersion === undefined
    ? database().prepare('INSERT INTO records (key,kind,record_id,municipality,station_id,data,version,created_at,updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE EXISTS (SELECT 1 FROM records WHERE key = ? AND version = ?)').bind(key, 'approval', value.id, station.value.municipality, station.value.id, data, stamp, stamp, stationKey, station.version)
    : database().prepare('UPDATE records SET data = ?, version = version + 1, updated_at = ? WHERE key = ? AND version = ? AND EXISTS (SELECT 1 FROM records WHERE key = ? AND version = ?)').bind(data, stamp, key, previousVersion, stationKey, station.version);
  const stationMutation = database().prepare("UPDATE records SET data = ?, version = version + 1, updated_at = ? WHERE key = ? AND version = ? AND EXISTS (SELECT 1 FROM records WHERE key = ? AND json_extract(data, '$.approvalRevision') = ?)").bind(JSON.stringify({ ...station.value, locationStatus: 'approved' }), stamp, stationKey, station.version, key, revision);
  const result = await database().batch([mutation, stationMutation, auditStatement(session, 'Одобрено местоположение', key, `Експерт: ${value.expert}; общинско основание: ${value.municipalReference}; документ: ${value.documentReference}; учебно съгласуване`, station.value.municipality, true)]);
  if (!result[0].meta.changes || !result[1].meta.changes) throw new ApiError(409, 'Станцията или съгласуването са променени междувременно. Презаредете данните.');
}

async function initialise() {
  const done = await database().prepare("SELECT value FROM app_settings WHERE key = 'seed_v1'").first();
  if (!done) {
    const stamp = nowISO();
    const initial: { kind: string; value: any; municipality: string | null }[] = [
      ...seedStations.map(value => ({ kind: 'station', value, municipality: value.municipality })),
      ...seedRules.map(value => ({ kind: 'rule', value, municipality: null })),
      { kind: 'order', municipality: 'Трявна', value: { id: 'ORD-DEMO-001', municipality: 'Трявна', productId: 'rls500', quantity: 1, reason: 'Учебна заявка за резервен радарен сензор към пилотния комплект.', status: 'submitted', createdAt: stamp, createdBy: 'Демонстрационен екип', note: 'Примерна вътрешна заявка. Няма поръчка към доставчик.', demo: true } },
      { kind: 'ticket', municipality: 'Трявна', value: { id: 'SRV-DEMO-001', stationId: 'TRV-001', subject: 'Планирана проверка на пилотния комплект', description: 'Учебна сервизна задача: визуална проверка, захранване и съпоставка с водомерната рейка.', priority: 'normal', status: 'open', createdAt: stamp, createdBy: 'Демонстрационен екип' } },
      { kind: 'approval', municipality: 'Трявна', value: { id: 'APR-DEMO-001', stationId: 'TRV-001', expert: '', municipalReference: '', regime: '', documentReference: '', status: 'draft', notes: 'Мястото предстои да се определи от специалисти и общината. Пунктът на картата е примерен.', createdAt: stamp } },
    ];
    const statements = initial.map(({kind, value, municipality}) => database().prepare("INSERT OR IGNORE INTO records (key, kind, record_id, municipality, station_id, data, version, created_at, updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'seed_v1')").bind(`${kind}:${value.id}`, kind, value.id, municipality, value.stationId || null, JSON.stringify(value), stamp, stamp));
    statements.push(database().prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('seed_v1', ?)").bind(stamp));
    await database().batch(statements);
  }
  await addTryavnaPilotStations();
}

async function addTryavnaPilotStations() {
  const key = 'seed_tryavna_five_stations_v1';
  const done = await database().prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first();
  if (done) return;
  const stamp = nowISO();
  const additions = seedStations.filter(station => station.id === 'TRV-004' || station.id === 'TRV-005');
  // Маркерът и двата записа се прилагат атомарно. Проверката вътре в batch
  // пази и от успоредни заявки; съществуващ идентификатор не се презаписва.
  const statements = additions.map(station => database().prepare('INSERT OR IGNORE INTO records (key, kind, record_id, municipality, station_id, data, version, created_at, updated_at) SELECT ?,?,?,?,?,?,1,?,? WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = ?)').bind(`station:${station.id}`, 'station', station.id, station.municipality, null, JSON.stringify(station), stamp, stamp, key));
  statements.push(database().prepare('INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)').bind(key, stamp));
  await database().batch(statements);
}

async function getSession(): Promise<Session> {
  const identity = await getChatGPTUser();
  const preview = !identity && process.env.NODE_ENV !== 'production';
  if (!identity && !preview) throw new ApiError(401, 'Влезте в профила си, за да използвате приложението.');
  const userId = identity?.userId || 'local-preview-owner';
  const name = identity?.displayName || 'Екип RiverGuard';
  const db = database();
  // Първоначалното присвояване е за създадения частен сайт, достъпен само за собственика.
  // Преди промяна на аудиторията собственикът трябва да е посетил приложението.
  // Локалният преглед използва отделен D1 и не определя производствения собственик.
  await db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('initial_owner', ?)").bind(userId).run();
  const owner = await db.prepare("SELECT value FROM app_settings WHERE key = 'initial_owner'").first<{ value: string }>();
  await db.prepare('INSERT OR IGNORE INTO memberships (user_id, name, role, municipality, created_at) VALUES (?,?,?,?,?)').bind(userId, name, owner?.value === userId ? 'admin' : 'viewer', null, nowISO()).run();
  const membership = await db.prepare('SELECT user_id, name, role, municipality FROM memberships WHERE user_id = ?').bind(userId).first<MemberRow>();
  if (!membership || !ROLES.includes(membership.role)) throw new ApiError(403, 'Няма валидно членство в системата.');
  const stored = membership.role === 'admin' ? await db.prepare('SELECT role, municipality FROM demo_sessions WHERE user_id = ?').bind(userId).first<{ role: Role; municipality: string | null }>() : null;
  const role = stored && ROLES.includes(stored.role) ? stored.role : membership.role;
  return { userId, name: membership.name, role, municipality: stored?.municipality ?? membership.municipality, actualRole: membership.role, demo: !!stored && role !== membership.role, preview };
}

function scoped<T extends { municipality?: string; stationId?: string }>(values: T[], session: Session, stations: Station[]): T[] {
  if (session.role === 'admin' || session.role === 'analyst') return values;
  if (session.role === 'viewer') return [];
  const stationMap = new Map(stations.map(s => [s.id, s.municipality]));
  return values.filter(value => (value.municipality || stationMap.get(value.stationId || '')) === session.municipality);
}
async function currentStations(): Promise<Station[]> {
  const stations = await records<Station>('station');
  const latest = await database().prepare('SELECT r.data FROM raw_measurements r WHERE r.id = (SELECT x.id FROM raw_measurements x WHERE x.station_id = r.station_id ORDER BY x.measured_at DESC, x.id DESC LIMIT 1)').all<{ data: string }>();
  const devices = new Map(latest.results.map(r => { const reading = JSON.parse(r.data) as Reading; return [reading.stationId, reading]; }));
  const flags = await database().prepare('SELECT reading_id, quality FROM measurement_annotations ORDER BY created_at DESC, id DESC LIMIT 10000').all<{ reading_id: string; quality: Reading['quality'] }>();
  const qualities = new Map<string, Reading['quality']>();
  for (const flag of flags.results) if (!qualities.has(flag.reading_id)) qualities.set(flag.reading_id, flag.quality);
  return stations.map(station => {
    const device = devices.get(station.id);
    let current = device ? withQuality(device) : simulatedReading(station) as Reading;
    if (device && Date.now() - Date.parse(device.measuredAt) > station.transmitInterval * 3000) current = { ...current, status: 'offline' };
    if (qualities.has(current.id)) current = withQuality(current, qualities.get(current.id)!);
    return { ...station, current };
  });
}
async function evaluateRules(stations: Station[]) {
  const rules = await records<Rule>('rule');
  const due = rules.filter(r => r.enabled && (!r.lastRun || Date.now() - Date.parse(r.lastRun) >= r.interval * 1000));
  const states = new Map((await records<any>('signal_state')).map(value => [value.id, value]));
  const stamp = nowISO();
  const batch: D1PreparedStatement[] = [];
  for (const station of stations) {
    const current = station.current!;
    for (const rule of due) {
      let severity: Alert['severity'] | null = null;
      let title = '';
      if (rule.id === 'threshold' && current.quality === 'valid' && ['warning', 'critical'].includes(current.status)) {
        severity = current.status as 'warning' | 'critical'; title = severity === 'critical' ? 'Превишен учебен критичен праг' : 'Превишен учебен предупредителен праг';
      }
      if (rule.id === 'stale' && current.status === 'offline') { severity = 'offline'; title = 'Липсва актуална телеметрия'; }
      if (rule.id === 'battery' && current.battery < 20) { severity = 'warning'; title = 'Зарядът на батерията е под 20%'; }
      if (rule.id === 'quality') {
        const reasons: string[] = [];
        if (['suspect', 'missing'].includes(current.quality)) reasons.push('съмнително или липсващо основно измерване');
        if (station.sensors.includes('pls500') && ['suspect', 'missing'].includes(current.levelBackupQuality)) reasons.push('съмнително или липсващо резервно измерване');
        if (current.levelDelta !== null && Math.abs(current.levelDelta) > 0.05) reasons.push('разлика над учебния праг 0,05 m');
        if (reasons.length) { severity = 'warning'; title = `Проверка на качеството: ${reasons.join('; ')}`; }
      }
      const stateId = `${station.id}-${rule.id}`;
      const previous = states.get(stateId);
      if (previous && previous.severity === severity) continue;
      if (!previous && !severity) continue;
      const generation = (previous?.generation || 0) + (severity ? 1 : 0);
      const alertId = severity ? `${alertKey(station.id, severity, rule.id)}-${generation}` : null;
      if (severity && alertId) {
        const value: Alert = { id: alertId, stationId: station.id, title, severity, createdAt: stamp, status: 'open' };
        batch.push(database().prepare('INSERT OR IGNORE INTO records (key,kind,record_id,municipality,station_id,data,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?)').bind(`alert:${alertId}`, 'alert', alertId, station.municipality, station.id, JSON.stringify(value), stamp, stamp));
      }
      const state = { id: stateId, stationId: station.id, severity, alertId, generation, updatedAt: stamp };
      batch.push(database().prepare('INSERT INTO records (key,kind,record_id,municipality,station_id,data,version,created_at,updated_at) VALUES (?,?,?,?,?,?,1,?,?) ON CONFLICT(key) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at').bind(`signal_state:${stateId}`, 'signal_state', stateId, station.municipality, station.id, JSON.stringify(state), stamp, stamp));
    }
  }
  for (const rule of due) batch.push(database().prepare('UPDATE records SET data = ?, updated_at = ? WHERE key = ?').bind(JSON.stringify({ ...rule, lastRun: stamp }), stamp, `rule:${rule.id}`));
  if (batch.length) await database().batch(batch);
}
async function bootstrap(session: Session): Promise<Bootstrap> {
  const stations = await currentStations();
  await evaluateRules(stations);
  const [alerts, orders, tickets, approvals, rules, training, members, audit] = await Promise.all([
    records<Alert>('alert'), records<Order>('order'), records<Ticket>('ticket'), records<Approval>('approval'), records<Rule>('rule'),
    database().prepare('SELECT training_id FROM training_completions WHERE user_id = ?').bind(session.userId).all<{ training_id: string }>(),
    session.role === 'admin' ? database().prepare('SELECT user_id, name, role, municipality FROM memberships ORDER BY name').all<MemberRow>() : Promise.resolve({ results: [] as MemberRow[] }),
    session.role === 'admin' || session.role === 'analyst'
      ? database().prepare('SELECT id, actor, role, action, entity, details, created_at AS createdAt FROM audit_log ORDER BY created_at DESC LIMIT 100').all<any>()
      : database().prepare('SELECT id, actor, role, action, entity, details, created_at AS createdAt FROM audit_log WHERE actor_id = ? OR (? IS NOT NULL AND municipality = ?) ORDER BY created_at DESC LIMIT 100').bind(session.userId, session.municipality, session.municipality).all<any>(),
  ]);
  return { session, stations, alerts: alerts.sort((a,b) => b.createdAt.localeCompare(a.createdAt)), orders: scoped(orders, session, stations), tickets: scoped(tickets, session, stations), approvals: scoped(approvals, session, stations), audit: session.role === 'viewer' ? [] : audit.results, rules, trainingCompletions: training.results.map(x => x.training_id), memberships: members.results.map(x => ({ userId: x.user_id, name: x.name, role: x.role, municipality: x.municipality })), serverTime: nowISO() };
}

async function getMeasurements(params: URLSearchParams, session: Session, exporting = false) {
  const period = parsePeriod(params);
  if (params.get('quality')) oneOf(params.get('quality'), ['valid', 'suspect', 'missing'], 'Качество');
  let stations = (await records<Station>('station')).filter(station => stationMatches(station, params));
  if (exporting) {
    assertRole(session, ['admin', 'municipal', 'analyst']);
    if (session.role === 'municipal' && params.get('municipality') && params.get('municipality') !== session.municipality) throw new ApiError(403, 'Експортът е ограничен до Вашата община.');
    if (session.role === 'municipal' && params.get('station') && stations.some(s => !canExport(session, s.municipality))) {
      const historical = await database().prepare("SELECT id FROM raw_measurements WHERE station_id = ? AND json_extract(data, '$.stationSnapshot.municipality') = ? LIMIT 1").bind(params.get('station'), session.municipality).first();
      if (!historical) throw new ApiError(403, 'Експортът е ограничен до Вашата община.');
    }
    stations = stations.filter(station => canExport(session, station.municipality));
  }
  const stationIds = new Set(stations.map(s => s.id));
  const annotationRows = await database().prepare('SELECT reading_id, station_id, quality FROM measurement_annotations ORDER BY created_at DESC, id DESC LIMIT 20000').all<{ reading_id: string; station_id: string; quality: Reading['quality'] }>();
  const flags = new Map<string, Reading['quality']>();
  for (const a of annotationRows.results) if (stationIds.has(a.station_id) && !flags.has(a.reading_id)) flags.set(a.reading_id, a.quality);
  const allDevice = await database().prepare('SELECT DISTINCT station_id FROM raw_measurements').all<{ station_id: string }>();
  const deviceStations = new Set(allDevice.results.map(x => x.station_id));
  const quality = params.get('quality') || '';
  const output: Reading[] = [];
  let total = 0;
  {
    const qualitySql = "COALESCE((SELECT a.quality FROM measurement_annotations a WHERE a.reading_id = r.id ORDER BY a.created_at DESC, a.id DESC LIMIT 1), json_extract(r.data, '$.quality'))";
    const clauses = ['r.measured_at >= ?', 'r.measured_at <= ?', `(? = '' OR ${qualitySql} = ?)`];
    const args: (string | number | null)[] = [new Date(period.from).toISOString(), new Date(period.to).toISOString(), quality, quality];
    if (params.get('station')) { clauses.push('r.station_id = ?'); args.push(params.get('station')); }
    for (const field of ['oblast', 'municipality', 'river', 'basin', 'region']) {
      if (params.get(field)) { clauses.push(`json_extract(r.data, '$.stationSnapshot.${field}') = ?`); args.push(params.get(field)); }
    }
    if (exporting && session.role === 'municipal') { clauses.push("json_extract(r.data, '$.stationSnapshot.municipality') = ?"); args.push(session.municipality); }
    const where = clauses.join(' AND ');
    const [raw, count] = await Promise.all([
      database().prepare(`SELECT r.data, ${qualitySql} AS effective_quality FROM raw_measurements r WHERE ${where} ORDER BY r.measured_at DESC, r.id LIMIT 10000`).bind(...args).all<{ data: string; effective_quality: Reading['quality'] }>(),
      database().prepare(`SELECT COUNT(*) AS n FROM raw_measurements r WHERE ${where}`).bind(...args).first<{ n: number }>(),
    ]);
    for (const row of raw.results) output.push(withQuality(JSON.parse(row.data), row.effective_quality));
    total += count?.n || 0;
  }
  // Един курсор за станция осигурява най-новите 10 000 измервания от целия набор,
  // без да се генерира неограничена история в паметта.
  const heads: { station: Station; time: number; interval: number; baseQuality: string }[] = [];
  for (const station of stations) {
    if (deviceStations.has(station.id)) continue;
    const interval = station.interval * 1000;
    const last = Math.min(period.to, Date.parse(simulatedReading(station, period.to).measuredAt));
    const end = Math.floor(last / interval) * interval;
    const first = Math.ceil(period.from / interval) * interval;
    if (end < first) continue;
    const baseQuality = 'valid';
    const count = Math.floor((end - first) / interval) + 1;
    if (!quality || quality === baseQuality) {
      total += count;
      heads.push({station,time:end,interval,baseQuality});
    }
    for (const [readingId, flagged] of flags) {
      const prefix = `SIM-${station.id}-`;
      if (!readingId.startsWith(prefix)) continue;
      const time = Number(readingId.slice(prefix.length));
      if (!Number.isFinite(time) || time < first || time > end || time % interval !== 0) continue;
      if (quality && quality === baseQuality && flagged !== quality) total--;
      if (quality && quality !== baseQuality && flagged === quality) {
        total++;
        output.push(withQuality(simulatedReading(station, time) as Reading, flagged));
      }
    }
  }
  let produced = 0;
  while (heads.length && produced < 10000) {
    let index = 0;
    for (let i = 1; i < heads.length; i++) if (heads[i].time > heads[index].time || (heads[i].time === heads[index].time && heads[i].station.id < heads[index].station.id)) index = i;
    const head = heads[index];
    let reading = simulatedReading(head.station, head.time) as Reading;
    if (flags.has(reading.id)) reading = withQuality(reading, flags.get(reading.id)!);
    if (!quality || reading.quality === quality) { output.push(reading); produced++; }
    head.time -= head.interval;
    if (head.time < period.from) heads.splice(index, 1);
  }
  output.sort((a,b) => b.measuredAt.localeCompare(a.measuredAt) || a.stationId.localeCompare(b.stationId));
  const truncated = total > 10000;
  return { readings: output.slice(0, 10000), total, truncated, limit: 10000, from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString(), generatedAt: nowISO(), timezone: 'UTC', sourceNote: 'Записите source=simulated са учебни и историята им се преизчислява по текущата конфигурация. Реалната телеметрия пази неизменна снимка на метаданните при приемане. levelDelta е резервно минус основно ниво в метри. Дебит не е въведен без валидиран профил и модел.', stations };
}

async function ingest(request: Request) {
  const key = (env as unknown as Record<string, unknown>).RIVERGUARD_INGEST_KEY;
  if (typeof key !== 'string' || key.length < 32) throw new ApiError(503, 'Приемането на реална телеметрия не е конфигурирано.');
  const candidate = request.headers.get('authorization') || '';
  const expected = `Bearer ${key}`;
  const encoder = new TextEncoder();
  const [a,b] = await Promise.all([crypto.subtle.digest('SHA-256', encoder.encode(candidate)), crypto.subtle.digest('SHA-256', encoder.encode(expected))]);
  const av = new Uint8Array(a); const bv = new Uint8Array(b); let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  if (diff) throw new ApiError(401, 'Невалидно удостоверяване на устройството.');
  const input = await bodyOf(request);
  const storedStation = await record<Station>('station', requiredText(input.stationId, 'Станция', 80));
  const station = { ...storedStation.value, version: storedStation.version };
  const reading = validateIngest(input, station);
  const result = await database().prepare('INSERT OR IGNORE INTO raw_measurements (id, station_id, measured_at, data, received_at) VALUES (?,?,?,?,?)').bind(reading.id, reading.stationId, reading.measuredAt, JSON.stringify(reading), reading.receivedAt).run();
  if (!result.meta.changes) throw new ApiError(409, 'Измерване с този идентификатор вече е прието; оригиналът е запазен.');
  await evaluateRules(await currentStations());
  return json({ accepted: true, id: reading.id }, 201);
}

export async function handleApi(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    const [resource, id, action] = parts;
    if (parts.length > 3) throw new ApiError(404, 'Непозната операция.');
    if (resource === 'ingest' && request.method === 'POST') return await ingest(request);
    const session = await getSession();
    await initialise();
    if (request.method === 'GET') {
      if (parts.length !== 1) throw new ApiError(404, 'Непозната справка.');
      if (resource === 'bootstrap') return json(await bootstrap(session));
      if (resource === 'measurements') { const { stations: _stations, ...data } = await getMeasurements(url.searchParams, session); return json(data); }
      if (resource === 'export') {
        const result = await getMeasurements(url.searchParams, session, true);
        const format = oneOf(url.searchParams.get('format') || 'csv', ['csv', 'json'], 'Формат');
        await auditStatement(session, 'Експорт', 'measurements', `${result.readings.length} записа; ${format}; ${result.from} — ${result.to}${result.truncated ? '; ограничен набор' : ''}`, session.role === 'municipal' ? session.municipality : null).run();
        if (format === 'json') { const { stations: _stations, ...data } = result; return new Response(JSON.stringify(data, null, 2), { headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="riverguard-measurements.json"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-riverguard-truncated': String(result.truncated) } }); }
        const stationMap = new Map(result.stations.map(s => [s.id, s]));
        const header = ['Измерване ID', 'Станция', 'Река', 'Община', 'Област', 'Географска ширина', 'Географска дължина', 'Версия на станцията', 'Измерено UTC', 'Получено UTC', 'Основно радарно ниво m спрямо условна нула', 'Резервно ниво PLS m', 'Разлика резервно минус основно m', 'Качество на резервното ниво', 'Температура °C', 'Валеж mm за последните 60 минути', 'Скорост m/s', 'Дебит m³/s', 'Качество', 'Произход', 'Статус', 'Експорт UTC', 'Ограничен набор'];
        const rows = result.readings.map(r => {
          const s = stationMap.get(r.stationId);
          const snapshot = r.stationSnapshot || (r.source === 'simulated' && s ? { stationName: s.name, river: s.river, municipality: s.municipality, oblast: s.oblast, lat: s.lat, lng: s.lng, stationVersion: s.version } : undefined);
          return [r.id, snapshot?.stationName, snapshot?.river, snapshot?.municipality, snapshot?.oblast, snapshot?.lat, snapshot?.lng, snapshot?.stationVersion, r.measuredAt, r.receivedAt, r.level, r.levelBackup, r.levelDelta, r.levelBackupQuality, r.temperature, r.rain, r.velocity, r.discharge, r.quality, r.source, r.status, result.generatedAt, result.truncated ? 'да' : 'не'].map(csvCell).join(';');
        });
        return new Response('\uFEFF' + [header.map(csvCell).join(';'), ...rows].join('\r\n'), { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="riverguard-measurements.csv"', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-riverguard-truncated': String(result.truncated) } });
      }
      throw new ApiError(404, 'Непозната справка.');
    }
    if (!['POST', 'PATCH'].includes(request.method)) throw new ApiError(405, 'Методът не се поддържа.');
    assertSameOrigin(request);
    const input = await bodyOf(request);
    const collection = ['stations', 'orders', 'tickets', 'approvals'].includes(resource);
    if (collection && !((request.method === 'POST' && parts.length === 1) || (request.method === 'PATCH' && parts.length === 2))) throw new ApiError(405, 'Недопустим метод или адрес за операцията.');
    if (['alerts', 'measurements', 'trainings'].includes(resource) && (request.method !== 'POST' || parts.length !== 3)) throw new ApiError(405, 'Недопустим метод или адрес за операцията.');
    if (['session', 'memberships'].includes(resource) && (request.method !== 'POST' || parts.length !== 1)) throw new ApiError(405, 'Недопустим метод или адрес за операцията.');
    if (resource === 'session' && request.method === 'POST') {
      if (session.actualRole !== 'admin') throw new ApiError(403, 'Само действителният администратор може да превключва демонстрационни роли.');
      const role = oneOf(input.role, ROLES, 'Роля') as Role;
      const municipality = ['municipal', 'technician'].includes(role) ? requiredText(input.municipality, 'Община', 160) : null;
      if (municipality && !(await records<Station>('station')).some(s => s.municipality === municipality)) throw new ApiError(400, 'Общината не присъства в демонстрационния регистър.');
      await database().batch([database().prepare('INSERT INTO demo_sessions (user_id, role, municipality, updated_at) VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role, municipality=excluded.municipality, updated_at=excluded.updated_at').bind(session.userId, role, municipality, nowISO()), auditStatement(session, 'Демонстрационен профил', session.userId, `${role}${municipality ? ': ' + municipality : ''}`, municipality)]);
      return json({ success: true });
    }
    if (resource === 'stations') {
      if (request.method === 'POST' && !id) {
        const value = validateStation(input, null, session);
        await saveRecord('station', value, session, value.municipality);
        return json(value, 201);
      }
      if (request.method === 'PATCH' && id) {
        const old = await record<Station>('station', id);
        if (input.version !== undefined && input.version !== old.version) throw new ApiError(409, 'Станцията е променена междувременно. Презаредете данните.');
        const value = validateStation(input, old.value, session);
        if (value.health !== old.value.health && value.health !== 'online') value.stoppedAt = nowISO();
        if (value.health === 'online') delete value.stoppedAt;
        const previousSection: Record<string, unknown> = { ...old.value.riverSection };
        const sectionChanged = Object.entries(value.riverSection).some(([key, next]) => next !== previousSection[key]);
        const locationChanged = (['lat', 'lng', 'municipality', 'river'] as const).some(key => value[key] !== old.value[key]);
        const details = sectionChanged
          ? `${value.name}; речен участък: ${locationChanged ? 'нулиран след промяна на местоположението' : 'обновен профил'}; ${value.riverSection.status === 'verified' ? `потвърден от ${value.riverSection.reviewedBy}, документ: ${value.riverSection.reference}` : 'за експертна проверка'}`
          : undefined;
        await saveRecord('station', value, session, value.municipality, old.version, details);
        return json({ ...value, version: old.version + 1 });
      }
    }
    if (resource === 'orders') {
      const old = id ? await record<Order>('order', id) : null;
      if (request.method === 'PATCH' && !old) throw new ApiError(404, 'Посочете заявка.');
      const value = validateOrder(input, old?.value, session);
      if (!old) Object.assign(value, { id: uid('ORD'), createdAt: nowISO(), createdBy: session.name });
      await saveRecord('order', value, session, value.municipality, old?.version);
      return json(value, old ? 200 : 201);
    }
    if (resource === 'tickets') {
      const old = id ? await record<Ticket>('ticket', id) : null;
      const stationId = old?.value.stationId || requiredText(input.stationId, 'Станция', 80);
      if (old && input.stationId !== undefined && input.stationId !== stationId) throw new ApiError(400, 'Станцията на сервизната задача не може да се променя.');
      const station = (await record<Station>('station', stationId)).value;
      assertScope(session, station.municipality, ['admin', 'municipal', 'technician']);
      const status = oneOf(input.status ?? old?.value.status ?? 'open', ['open', 'in_progress', 'resolved'], 'Статус');
      const resolution = input.resolution ?? old?.value.resolution;
      if (status === 'resolved') requiredText(resolution, 'Описание на решението', 4000);
      const value: Ticket = { ...old?.value, id: old?.value.id || uid('SRV'), stationId, subject: requiredText(input.subject ?? old?.value.subject, 'Тема', 200), description: requiredText(input.description ?? old?.value.description, 'Описание', 4000), priority: oneOf(input.priority ?? old?.value.priority ?? 'normal', ['normal', 'high', 'critical'], 'Приоритет'), status, createdAt: old?.value.createdAt || nowISO(), createdBy: old?.value.createdBy || session.name, ...(resolution ? { resolution: requiredText(resolution, 'Решение', 4000) } : {}) };
      await saveRecord('ticket', value, session, station.municipality, old?.version);
      return json(value, old ? 200 : 201);
    }
    if (resource === 'approvals') {
      const old = id ? await record<Approval>('approval', id) : null;
      const stationId = old?.value.stationId || requiredText(input.stationId, 'Станция', 80);
      if (old && input.stationId !== undefined && input.stationId !== stationId) throw new ApiError(400, 'Съгласуването е за конкретна станция.');
      const station = await record<Station>('station', stationId);
      const snapshot = { lat: station.value.lat, lng: station.value.lng, river: station.value.river, municipality: station.value.municipality };
      const previousSnapshot = (old?.value as any)?.locationSnapshot;
      if (previousSnapshot && JSON.stringify(previousSnapshot) !== JSON.stringify(snapshot)) throw new ApiError(409, 'Местоположението е променено след създаване на съгласуването. Необходимо е ново съгласуване за новия пункт.');
      const value = { ...validateApproval(input, old?.value, session, station.value.municipality), id: old?.value.id || uid('APR'), stationId, createdAt: old?.value.createdAt || nowISO(), locationSnapshot: previousSnapshot || snapshot };
      if (value.status === 'approved') await saveApprovedApproval(value, old?.version, station, session);
      else await saveRecord('approval', value, session, station.value.municipality, old?.version);
      return json(value, old ? 200 : 201);
    }
    if (resource === 'alerts' && id && action === 'ack') {
      const old = await record<Alert>('alert', id);
      const station = (await record<Station>('station', old.value.stationId)).value;
      assertScope(session, station.municipality, ['admin', 'municipal']);
      const note = requiredText(input.note, 'Бележка към потвърждението', 2000);
      if (old.value.status === 'acknowledged') return json(old.value);
      const value = { ...old.value, status: 'acknowledged', ackBy: session.name, ackAt: nowISO(), note };
      await saveRecord('alert', value, session, station.municipality, old.version);
      return json(value);
    }
    if (resource === 'rules' && id && request.method === 'PATCH') {
      assertRole(session, ['admin']);
      const old = await record<Rule>('rule', id);
      if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new ApiError(400, 'Невалидно състояние на правилото.');
      const value = { ...old.value, enabled: input.enabled ?? old.value.enabled, interval: input.interval === undefined ? old.value.interval : numberIn(input.interval, 'Интервал', 10, 86400, true) };
      await saveRecord('rule', value, session, null, old.version);
      return json(value);
    }
    if (resource === 'trainings' && id && action === 'complete') {
      if (!['TR-01', 'TR-02', 'TR-03', 'TR-04', 'TR-05', 'TR-06'].includes(id)) throw new ApiError(400, 'Невалиден идентификатор на обучение.');
      await database().batch([database().prepare('INSERT OR IGNORE INTO training_completions (id, user_id, training_id, completed_at) VALUES (?,?,?,?)').bind(`${session.userId}:${id}`, session.userId, id, nowISO()), auditStatement(session, 'Обучение', id, 'Отбелязано като преминато; не представлява удостоверение за квалификация.', session.municipality, true)]);
      return json({ success: true });
    }
    if (resource === 'measurements' && id && action === 'flag') {
      const raw = await database().prepare('SELECT data FROM raw_measurements WHERE id = ?').bind(id).first<{ data: string }>();
      let reading: Reading;
      if (raw) reading = JSON.parse(raw.data);
      else {
        const match = /^SIM-(.+)-(\d+)$/.exec(id);
        if (!match) throw new ApiError(404, 'Измерването не е намерено.');
        const station = (await record<Station>('station', match[1])).value;
        const time = Number(match[2]);
        if (!Number.isFinite(time) || time > Date.now() || time < Date.now() - 7 * 86400000) throw new ApiError(400, 'Измерването е извън допустимия период за корекция.');
        reading = simulatedReading(station, time) as Reading;
        if (reading.id !== id) throw new ApiError(404, 'Измерването не е намерено.');
      }
      const station = (await record<Station>('station', reading.stationId)).value;
      const readingMunicipality = reading.source === 'device' ? reading.stationSnapshot?.municipality : station.municipality;
      if (!readingMunicipality) throw new ApiError(409, 'Липсва записана териториална принадлежност на измерването.');
      assertScope(session, readingMunicipality);
      const quality = oneOf(input.quality, ['valid', 'suspect', 'missing'], 'Качество');
      const reason = requiredText(input.reason, 'Причина за маркиране', 2000);
      await database().batch([database().prepare('INSERT INTO measurement_annotations (id, reading_id, station_id, quality, reason, actor_id, created_at) VALUES (?,?,?,?,?,?,?)').bind(uid('ANN'), id, reading.stationId, quality, reason, session.userId, nowISO()), auditStatement(session, 'Маркиране на измерване', id, `${quality}: ${reason}; суровата стойност е запазена`, readingMunicipality)]);
      return json({ ...withQuality(reading, quality), originalQuality: reading.quality, reason });
    }
    if (resource === 'memberships' && request.method === 'POST') {
      assertRole(session, ['admin']);
      if (session.actualRole !== 'admin') throw new ApiError(403, 'Необходими са действителни администраторски права.');
      const userId = requiredText(input.userId, 'Потребителски идентификатор', 200);
      const role = oneOf(input.role, ROLES, 'Роля') as Role;
      const municipality = ['municipal', 'technician'].includes(role) ? requiredText(input.municipality, 'Община', 160) : null;
      const name = requiredText(input.name, 'Име', 160);
      if (userId === session.userId && role !== 'admin') throw new ApiError(400, 'Не можете да отнемете собствените си администраторски права.');
      if (municipality && !(await records<Station>('station')).some(s => s.municipality === municipality)) throw new ApiError(400, 'Неизвестна община.');
      await database().batch([database().prepare('INSERT INTO memberships (user_id, name, role, municipality, created_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET name=excluded.name, role=excluded.role, municipality=excluded.municipality').bind(userId, name, role, municipality, nowISO()), database().prepare('DELETE FROM demo_sessions WHERE user_id = ?').bind(userId), auditStatement(session, 'Права за достъп', userId, `${name}: ${role}${municipality ? ', ' + municipality : ''}`, municipality)]);
      return json({ userId, name, role, municipality } satisfies Membership);
    }
    throw new ApiError(404, 'Непозната операция.');
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.message }, error.status);
    return json({ error: 'Възникна грешка при обработката. Данните не са потвърдени като записани. Опитайте отново.' }, 500);
  }
}
