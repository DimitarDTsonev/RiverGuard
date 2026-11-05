import { emptyRiverSection, enrichStationMetadata } from './station-metadata.mjs';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const ROLES = ['admin', 'municipal', 'analyst', 'technician', 'viewer'];
export const PRODUCT_IDS = ['rls500', 'pls500', 'pluvio', 'rq30', 'exo2', 'netdl', 'solar', 'gauge', 'cabinet'];
export const DEMO_OFFLINE_AT = Date.parse('2026-11-05T06:00:00.000Z');

export function requiredText(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ApiError(400, `${label}: попълнете текст до ${max} знака.`);
  return value.trim();
}
export function numberIn(value, label, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new ApiError(400, `${label}: допустима стойност от ${min} до ${max}.`);
  return value;
}
export function oneOf(value, values, label) {
  if (!values.includes(value)) throw new ApiError(400, `${label}: невалидна стойност.`);
  return value;
}
export function assertRole(session, roles) {
  if (!session || !roles.includes(session.role)) throw new ApiError(403, 'Вашата роля няма право да извърши това действие.');
}
export function assertScope(session, municipality, roles = ['admin', 'municipal']) {
  assertRole(session, roles);
  if (session.role !== 'admin' && session.municipality !== municipality) throw new ApiError(403, 'Действието е разрешено само за Вашата община.');
}
export function canExport(session, municipality) {
  return session.role === 'admin' || session.role === 'analyst' || (session.role === 'municipal' && session.municipality === municipality);
}
export function assertSameOrigin(request) {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if ((origin && origin !== new URL(request.url).origin) || site === 'cross-site') throw new ApiError(403, 'Заявката трябва да произхожда от това приложение.');
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Необходим е JSON формат на заявката.');
}
export function validateRiverSection(input, current, session) {
  if (input === undefined) return { ...current };
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError(400, 'Речният участък трябва да е обект с описани характеристики.');
  const fields = {
    name: ['Наименование на участъка', 160],
    channel: ['Корито и местност', 1500],
    flowRegime: ['Воден режим', 1500],
    floodRisks: ['Особености и рискове', 1500],
    monitoringFocus: ['Цел на наблюдението', 1500],
    waterBodyCode: ['Код на водното тяло', 80],
    typologyCode: ['Типологичен код', 40],
    sourceTitle: ['Източник', 300],
    sourceUrl: ['Адрес на източника', 1500],
    reference: ['Документ / становище', 500],
    reviewedBy: ['Проверил профила', 160],
    reviewedAt: ['Дата на проверката', 10],
  };
  const allowed = [...Object.keys(fields), 'position', 'terrain', 'status'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new ApiError(400, 'Речният участък съдържа непознато поле.');
  const value = Object.fromEntries(allowed.map(key => [key, current[key]]));
  for (const [key, [label, max]] of Object.entries(fields)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > max) throw new ApiError(400, `${label}: допустим е текст до ${max} знака.`);
    value[key] = input[key].trim();
  }
  requiredText(value.name, 'Наименование на участъка', 160);
  value.position = oneOf(input.position !== undefined ? input.position : current.position, ['upper', 'middle', 'lower', 'unknown'], 'Положение по течението');
  value.terrain = oneOf(input.terrain !== undefined ? input.terrain : current.terrain, ['mountain', 'foothill', 'lowland', 'mixed', 'unknown'], 'Характер на участъка');
  if (input.status !== undefined) oneOf(input.status, ['draft', 'verified'], 'Проверка на профила');
  if (value.sourceUrl) {
    let url;
    try { url = new URL(value.sourceUrl); } catch { throw new ApiError(400, 'Източникът трябва да е пълен http или https адрес.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || /[\u0000-\u0020\u007f]/.test(value.sourceUrl)) throw new ApiError(400, 'Източникът трябва да е http или https адрес без данни за вход.');
  }
  if (value.reviewedAt) {
    const date = Date.parse(`${value.reviewedAt}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value.reviewedAt) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== value.reviewedAt) throw new ApiError(400, 'Датата на проверката трябва да е реална календарна дата във формат ГГГГ-ММ-ДД.');
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Sofia' }).format(new Date());
    if (value.reviewedAt > today) throw new ApiError(400, 'Датата на проверката не може да бъде в бъдещето.');
  }
  const changed = allowed.some(key => key !== 'status' && value[key] !== current[key]);
  const verifies = input.status === 'verified' && session.role === 'admin';
  if (input.status === 'verified' && session.role !== 'admin' && current.status !== 'verified') assertRole(session, ['admin']);
  value.status = verifies ? 'verified' : input.status === 'draft' || changed ? 'draft' : current.status;
  if (value.status === 'verified') {
    for (const key of ['reviewedBy', 'reviewedAt', 'reference', 'sourceTitle']) requiredText(value[key], 'За потвърждение посочете проверил, дата, документ и източник', fields[key][1]);
  } else if (current.status === 'verified') {
    value.reviewedBy = '';
    value.reviewedAt = '';
  }
  return value;
}
export function validateStation(input, current, session) {
  const adding = !current;
  if (adding) assertRole(session, ['admin']); else assertScope(session, current.municipality);
  if (!adding && input.municipality !== undefined && input.municipality !== current.municipality && session.role !== 'admin') throw new ApiError(403, 'Не можете да премествате станция в друга община.');
  if (input.locationStatus !== undefined && input.locationStatus !== (current?.locationStatus || 'proposed')) throw new ApiError(400, 'Място за монтаж се одобрява само чрез експертно и общинско съгласуване.');
  if (!adding && input.id !== undefined && input.id !== current.id) throw new ApiError(400, 'Идентификаторът на станцията не може да се променя.');
  const previous = current ? enrichStationMetadata(current) : null;
  const s = { ...previous };
  for (const key of ['name', 'river', 'municipality', 'oblast', 'region', 'basin', 'kind']) if (adding || input[key] !== undefined) s[key] = requiredText(input[key], key, 160);
  for (const [key, min, max, integer] of [['lat', 41, 44.5, false], ['lng', 22, 29, false], ['interval', 5, 3600, true], ['transmitInterval', 5, 86400, true], ['warning', 0, 100, false], ['critical', 0, 100, false], ['baseLevel', -5, 100, false], ['battery', 0, 100, false], ['signal', 0, 100, false]]) {
    if (input[key] !== undefined) s[key] = numberIn(input[key], key, min, max, integer);
  }
  if (adding) {
    s.id = requiredText(input.id || `ST-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, 'Идентификатор', 40);
    if (!/^[A-Z0-9-]+$/.test(s.id)) throw new ApiError(400, 'Идентификаторът може да съдържа главни латински букви, цифри и тире.');
    for (const key of ['lat', 'lng']) if (s[key] === undefined) throw new ApiError(400, 'Посочете географските координати.');
    Object.assign(s, { interval: s.interval ?? 60, transmitInterval: s.transmitInterval ?? 60, warning: s.warning ?? 1.8, critical: s.critical ?? 2.35, baseLevel: s.baseLevel ?? 1.2, battery: s.battery ?? 100, signal: s.signal ?? 90, health: 'online', locationStatus: 'proposed', notes: '', sensors: ['rls500'], version: 1 });
  }
  if (input.health !== undefined) s.health = oneOf(input.health, ['online', 'offline', 'maintenance'], 'Състояние');
  if (input.sensors !== undefined) {
    if (!Array.isArray(input.sensors) || !input.sensors.length || input.sensors.length > 12 || input.sensors.some(x => typeof x !== 'string' || !PRODUCT_IDS.includes(x))) throw new ApiError(400, 'Изберете сензори от каталога.');
    s.sensors = [...new Set(input.sensors)];
  }
  if (input.notes !== undefined) {
    if (typeof input.notes !== 'string' || input.notes.length > 4000) throw new ApiError(400, 'Бележките са до 4000 знака.');
    s.notes = input.notes;
  }
  if (s.warning >= s.critical) throw new ApiError(400, 'Предупредителният праг трябва да е по-нисък от критичния.');
  if (s.transmitInterval < s.interval) throw new ApiError(400, 'Интервалът за предаване не може да е по-кратък от измерването.');
  const locationChanged = current && ['lat', 'lng', 'municipality', 'river'].some(k => s[k] !== current[k]);
  s.riverSection = validateRiverSection(input.riverSection, previous?.riverSection || emptyRiverSection(s), session);
  if (locationChanged) {
    s.locationStatus = 'proposed';
    const newFields = {};
    for (const key of Object.keys(input.riverSection || {})) {
      if (!['status', 'reviewedBy', 'reviewedAt'].includes(key) && s.riverSection[key] !== previous.riverSection[key]) newFields[key] = s.riverSection[key];
    }
    s.riverSection = validateRiverSection({ ...newFields, status:'draft' }, emptyRiverSection(s), session);
  }
  delete s.current;
  return s;
}
export function validateOrder(input, current, session) {
  const municipality = current?.municipality || requiredText(input.municipality, 'Община', 160);
  assertScope(session, municipality);
  if (current && input.municipality !== undefined && input.municipality !== municipality) throw new ApiError(400, 'Общината на заявката не може да се променя.');
  const status = input.status ?? current?.status ?? 'draft';
  oneOf(status, ['draft', 'submitted', 'approved', 'rejected', 'received'], 'Статус');
  if (!current && !['draft', 'submitted'].includes(status)) throw new ApiError(400, 'Новата заявка започва като чернова или подадена.');
  if (current && current.status !== status) {
    const transitions = { draft: ['submitted'], submitted: ['approved', 'rejected'], approved: ['received'], rejected: [], received: [] };
    if (!transitions[current.status].includes(status)) throw new ApiError(400, 'Недопустим преход на статуса на заявката.');
    if (['approved', 'rejected', 'received'].includes(status)) assertRole(session, ['admin']);
  }
  if (current && ['approved', 'received', 'rejected'].includes(current.status) && ['productId', 'quantity', 'reason'].some(k => input[k] !== undefined && input[k] !== current[k])) throw new ApiError(400, 'Съдържанието на приключена или одобрена заявка не се променя.');
  return { ...current, municipality, productId: oneOf(input.productId ?? current?.productId, PRODUCT_IDS, 'Продукт'), quantity: numberIn(input.quantity ?? current?.quantity, 'Количество', 1, 1000, true), reason: requiredText(input.reason ?? current?.reason, 'Основание', 2000), status, note: input.note === undefined ? (current?.note || '') : requiredText(input.note, 'Бележка', 2000), demo: true };
}
export function validateApproval(input, current, session, municipality) {
  assertScope(session, municipality);
  const value = { ...current };
  for (const k of ['expert', 'municipalReference', 'regime', 'documentReference', 'notes']) {
    const text = input[k] ?? current?.[k] ?? '';
    if (typeof text !== 'string' || text.length > 4000) throw new ApiError(400, 'Полето за съгласуване е невалидно.');
    value[k] = text.trim();
  }
  value.status = oneOf(input.status ?? current?.status ?? 'draft', ['draft', 'submitted', 'approved', 'rejected'], 'Статус');
  if (['approved', 'rejected'].includes(value.status) && value.status !== current?.status) assertRole(session, ['admin']);
  if (value.status === 'approved') for (const k of ['expert', 'municipalReference', 'regime', 'documentReference']) requiredText(value[k], 'Експерт, общинско основание, режим и документ са задължителни', 4000);
  if (current?.status === 'approved' && (value.status !== 'approved' || ['expert', 'municipalReference', 'regime', 'documentReference'].some(k => value[k] !== current[k]))) throw new ApiError(400, 'Одобреното съгласуване е неизменно. Създайте ново съгласуване.');
  return value;
}
export function levelDifference(level, levelBackup, quality = 'valid', levelBackupQuality = 'valid') {
  if (quality !== 'valid' || levelBackupQuality !== 'valid' || typeof level !== 'number' || !Number.isFinite(level) || typeof levelBackup !== 'number' || !Number.isFinite(levelBackup)) return null;
  return Math.round((levelBackup - level) * 1000) / 1000;
}
export function stationSnapshot(station) {
  return { stationName: station.name, river: station.river, municipality: station.municipality, oblast: station.oblast, region: station.region, basin: station.basin, lat: station.lat, lng: station.lng, stationVersion: station.version || 1 };
}
function hash(value) { let n = 0; for (const c of value) n = ((n * 31) + c.charCodeAt(0)) >>> 0; return n; }
export function simulatedReading(station, now = Date.now()) {
  const interval = station.interval * 1000;
  const cutoff = station.stoppedAt ? Date.parse(station.stoppedAt) : DEMO_OFFLINE_AT;
  const stopped = (station.health === 'offline' || station.health === 'maintenance') && now >= cutoff;
  const t = Math.floor((stopped ? cutoff - 1 : now) / interval) * interval;
  const phase = hash(station.id) % 628 / 100;
  const trueLevel = station.baseLevel + 0.028 * Math.sin(t / 1800000 + phase) + 0.012 * Math.cos(t / 7200000 + phase);
  const radarPhase = hash(`${station.id}:radar`) % 628 / 100;
  const pressurePhase = hash(`${station.id}:pressure`) % 628 / 100;
  const level = Math.round((trueLevel + 0.002 * Math.sin(t / 173000 + radarPhase)) * 1000) / 1000;
  const levelBackup = station.sensors.includes('pls500') ? Math.round((trueLevel + 0.003 * Math.sin(t / 239000 + pressurePhase) + 0.0015 * Math.cos(t / 541000 + pressurePhase)) * 1000) / 1000 : null;
  const levelBackupQuality = levelBackup === null ? 'missing' : 'valid';
  const levelDelta = levelDifference(level, levelBackup, 'valid', levelBackupQuality);
  const status = stopped ? station.health : level >= station.critical ? 'critical' : level >= station.warning ? 'warning' : 'normal';
  return { id: `SIM-${station.id}-${t}`, stationId: station.id, measuredAt: new Date(t).toISOString(), receivedAt: new Date(t + 1500).toISOString(), level, levelBackup, levelBackupQuality, levelDelta, stationSnapshot: stationSnapshot(station), temperature: Math.round((10 + 2.6 * Math.sin(t / 20000000 + phase)) * 10) / 10, rain: station.sensors.includes('pluvio') ? Math.max(0, Math.round((Math.sin(t / 12000000 + phase) - 0.7) * 200) / 10) : null, rainPeriodMinutes: station.sensors.includes('pluvio') ? 60 : null, velocity: station.sensors.includes('rq30') ? Math.round((0.6 + level * 0.2) * 100) / 100 : null, discharge: null, quality: 'valid', source: 'simulated', battery: station.battery, signal: station.signal, status };
}
export function alertKey(stationId, severity, kind = 'threshold') { return `ALT-${stationId}-${kind}-${severity}`; }
export function parsePeriod(params, now = Date.now()) {
  const to = params.get('to') ? Date.parse(params.get('to')) : now;
  const from = params.get('from') ? Date.parse(params.get('from')) : to - 24 * 3600000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || to - from > 7 * 86400000 || to > now + 60000) throw new ApiError(400, 'Изберете валиден период до 7 дни, без бъдещи измервания.');
  return { from, to };
}
export function stationMatches(station, params) {
  for (const [query, key] of [['station', 'id'], ['oblast', 'oblast'], ['municipality', 'municipality'], ['river', 'river'], ['basin', 'basin'], ['region', 'region']]) if (params.get(query) && station[key] !== params.get(query)) return false;
  return true;
}
export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) && typeof value !== 'number') text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
export function validateIngest(input, station, now = Date.now()) {
  if (!input || input.stationId !== station.id) throw new ApiError(400, 'Непозната станция.');
  const id = requiredText(input.id, 'Идентификатор на измерването', 120);
  if (id.startsWith('SIM-')) throw new ApiError(400, 'Префиксът SIM е запазен за демонстрационни данни.');
  if (typeof input.measuredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(input.measuredAt)) throw new ApiError(400, 'Времето трябва да е ISO 8601 с часова зона.');
  const time = Date.parse(input.measuredAt);
  if (!Number.isFinite(time) || time > now + 60000 || time < now - 30 * 86400000) throw new ApiError(400, 'Времето на измерване е невалидно или извън допустимите 30 дни.');
  const level = numberIn(input.level, 'Ниво', -5, 100);
  if (input.rain != null && input.rainPeriodMinutes !== 60) throw new ApiError(400, 'Валежът трябва да е натрупан за последните 60 минути (rainPeriodMinutes=60).');
  if (input.rain != null && !station.sensors.includes('pluvio')) throw new ApiError(400, 'За станцията няма регистриран валежомер.');
  if (input.levelBackup != null && !station.sensors.includes('pls500')) throw new ApiError(400, 'За станцията няма регистриран резервен сензор за ниво PLS.');
  if (input.velocity != null && !station.sensors.includes('rq30')) throw new ApiError(400, 'За станцията няма регистриран радар за скорост RQ-30.');
  if (input.discharge != null) throw new ApiError(400, 'Дебит не се приема без валидиран профил и модел на измервателното сечение. В прототипа такъв модел не е въведен.');
  const quality = oneOf(input.quality ?? 'valid', ['valid', 'suspect', 'missing'], 'Качество');
  const levelBackup = input.levelBackup == null ? null : numberIn(input.levelBackup, 'Резервно ниво', -5, 100);
  const levelBackupQuality = levelBackup === null ? 'missing' : oneOf(input.levelBackupQuality ?? 'valid', ['valid', 'suspect', 'missing'], 'Качество на резервното ниво');
  const levelDelta = levelDifference(level, levelBackup, quality, levelBackupQuality);
  return { id, stationId: station.id, measuredAt: new Date(time).toISOString(), receivedAt: new Date(now).toISOString(), level, levelBackup, levelBackupQuality, levelDelta, stationSnapshot: stationSnapshot(station), temperature: numberIn(input.temperature, 'Температура', -40, 80), rain: input.rain == null ? null : numberIn(input.rain, 'Валеж', 0, 1000), rainPeriodMinutes: input.rain == null ? null : 60, velocity: input.velocity == null ? null : numberIn(input.velocity, 'Скорост', 0, 25), discharge: null, quality, source: 'device', battery: numberIn(input.battery, 'Заряд', 0, 100), signal: numberIn(input.signal, 'Сигнал', 0, 100), status: level >= station.critical ? 'critical' : level >= station.warning ? 'warning' : 'normal' };
}
