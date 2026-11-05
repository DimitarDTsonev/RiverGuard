import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, assertScope, assertRole, assertSameOrigin, validateStation, validateOrder, validateApproval, simulatedReading, parsePeriod, csvCell, alertKey, canExport, validateIngest } from '../lib/domain.mjs';
import { emptyRiverSection, enrichStationMetadata } from '../lib/station-metadata.mjs';
import sectionContent from '../lib/river-sections-content.json' with { type: 'json' };

const admin = { role: 'admin', actualRole: 'admin', municipality: null };
const municipal = { role: 'municipal', actualRole: 'municipal', municipality: 'Трявна' };
const viewer = { role: 'viewer', actualRole: 'viewer', municipality: null };
const technician = { role: 'technician', actualRole: 'technician', municipality: 'Трявна' };
const station = { id:'TRV-001', name:'Горен участък', river:'Тревненска', municipality:'Трявна',oblast:'Габрово',region:'Северен централен',basin:'Дунавски',lat:42.85,lng:25.49,kind:'Планинска река',sensors:['rls500'], interval:60,transmitInterval:60, warning:1.8,critical:2.35,baseLevel:1.26,health:'online',battery:90,signal:80,locationStatus:'proposed',notes:'Учебен пункт',version:1 };
const fails = (fn, status) => assert.throws(fn, error => error instanceof ApiError && error.status === status);
test('общинският оператор управлява собствената община', () => assert.doesNotThrow(() => assertScope(municipal, 'Трявна')));
test('общинският оператор не управлява друга община', () => fails(() => assertScope(municipal, 'Пловдив'), 403));
test('администраторът управлява всички общини', () => assert.doesNotThrow(() => assertScope(admin, 'Пловдив')));
test('наблюдателят няма права за запис', () => fails(() => assertScope(viewer, 'Трявна'), 403));
test('техникът няма права за промяна на станции', () => fails(() => validateStation({notes:'X'}, station, technician), 403));
test('техникът има достъп до собствените сервизни задачи', () => assert.doesNotThrow(() => assertScope(technician, 'Трявна', ['admin','municipal','technician'])));
test('техникът няма сервизни права за чужда община', () => fails(() => assertScope(technician, 'Пловдив', ['admin','municipal','technician']), 403));
test('ефективната демонстрационна роля ограничава actual admin', () => fails(() => assertRole({...viewer,actualRole:'admin'}, ['admin']),403));
test('собствена станция се редактира', () => assert.equal(validateStation({notes:'Проверено'},station,municipal).notes,'Проверено'));
test('промяна на municipalityId не заобикаля обхвата', () => fails(() => validateStation({municipality:'Пловдив'},station,municipal),403));
test('нови станции се създават само от администратор', () => fails(() => validateStation(station,null,municipal),403));
test('PATCH не одобрява място за монтаж', () => fails(() => validateStation({locationStatus:'approved'},station,admin),400));
test('промяна на координати обезсилва одобрението на мястото', () => assert.equal(validateStation({lat:42.86},{...station,locationStatus:'approved'},admin).locationStatus,'proposed'));
test('праговете са подредени', () => fails(() => validateStation({warning:2.5,critical:2.1},station,admin),400));
test('интервалите са положителни', () => fails(() => validateStation({interval:0},station,admin),400));
test('координатите са ограничени до географския обхват', () => fails(() => validateStation({lat:70},station,admin),400));
test('серверът отказва външен Origin', () => fails(() => assertSameOrigin(new Request('https://river.example/api/orders',{method:'POST',headers:{origin:'https://attacker.example','content-type':'application/json'},body:'{}'})),403));
test('серверът отказва simple-form CSRF съдържание', () => fails(() => assertSameOrigin(new Request('https://river.example/api/orders',{method:'POST',headers:{origin:'https://river.example','content-type':'text/plain'},body:'{}'})),415));
test('JSON заявка от същия произход се допуска', () => assert.doesNotThrow(() => assertSameOrigin(new Request('https://river.example/api/orders',{method:'POST',headers:{origin:'https://river.example','content-type':'application/json'},body:'{}'}))));
const order = { municipality:'Трявна',productId:'rls500',quantity:2,reason:'Резерв за пилота',status:'draft' };
test('вътрешна заявка запазва демонстрационния характер', () => assert.equal(validateOrder(order,null,municipal).demo,true));
test('поръчка за чужда община се отказва', () => fails(() => validateOrder({...order,municipality:'Пловдив'},null,municipal),403));
test('неизвестен продукт се отказва', () => fails(() => validateOrder({...order,productId:'fake'},null,admin),400));
test('отрицателно и нецяло количество се отказва', () => { fails(() => validateOrder({...order,quantity:-1},null,admin),400); fails(() => validateOrder({...order,quantity:1.5},null,admin),400); });
test('общината не одобрява сама подадена заявка', () => fails(() => validateOrder({status:'approved'},{...order,status:'submitted'},municipal),403));
test('не може да се прескочи одобрението до получена доставка', () => fails(() => validateOrder({status:'received'},{...order,status:'submitted'},admin),400));
test('администратор одобрява подадена заявка', () => assert.equal(validateOrder({status:'approved'},{...order,status:'submitted'},admin).status,'approved'));
test('одобрено съгласуване изисква всички документи', () => fails(() => validateApproval({status:'approved'},null,admin,'Трявна'),400));
test('общината не може сама да потвърди окончателно съгласуване', () => fails(() => validateApproval({status:'approved',expert:'Експерт',municipalReference:'Протокол',regime:'Проверен',documentReference:'Документ'},null,municipal,'Трявна'),403));
test('пълно съгласуване се приема от администратор', () => assert.equal(validateApproval({status:'approved',expert:'Експерт',municipalReference:'Протокол',regime:'Проверен',documentReference:'Документ'},null,admin,'Трявна').status,'approved'));
test('същият измервателен интервал връща едни и същи данни', () => assert.deepEqual(simulatedReading(station,1800000000000),simulatedReading(station,1800000000999)));
test('offline timestamp не се обновява от презареждане', () => { const s={...station,health:'offline'}; const a=simulatedReading(s,1800000000000); const b=simulatedReading(s,1800003600000); assert.equal(a.measuredAt,b.measuredAt); assert.equal(a.receivedAt,b.receivedAt); assert.equal(a.status,'offline'); assert.equal(a.quality,'valid'); });
test('поддръжката не произвежда нови фиктивни измервания', () => { const s={...station,health:'maintenance'}; assert.equal(simulatedReading(s,1800000000000).measuredAt,simulatedReading(s,1800003600000).measuredAt); });
test('демонстрацията не измисля дебит без крива', () => assert.equal(simulatedReading(station).discharge,null));
test('аларменият ключ предотвратява дублиране при всеки refresh', () => assert.equal(new Set([alertKey('TRV-001','warning'),alertKey('TRV-001','warning')]).size,1));
test('различни типове аларми имат различни ключове', () => assert.notEqual(alertKey('TRV-001','warning','threshold'),alertKey('TRV-001','warning','battery')));
test('общинският експорт е териториално ограничен', () => { assert.equal(canExport(municipal,'Трявна'),true); assert.equal(canExport(municipal,'Пловдив'),false); assert.equal(canExport(viewer,'Трявна'),false); assert.equal(canExport({role:'analyst'},'Пловдив'),true); });
test('обърнат период се отказва', () => fails(() => parsePeriod(new URLSearchParams('from=2026-11-05&to=2026-11-04')),400));
test('период над седем дни се отказва', () => fails(() => parsePeriod(new URLSearchParams('from=2026-10-01&to=2026-10-10')),400));
test('CSV формула, включително след празно пространство, се обезврежда', () => { assert.equal(csvCell('=1+1'),'"\'=1+1"'); assert.equal(csvCell('\t@SUM(1)'), '"\'\t@SUM(1)"'); assert.equal(csvCell(' -2+3'),'"\' -2+3"'); });
test('CSV запазва числови отрицателни стойности и кавички', () => { assert.equal(csvCell(-2),'"-2"'); assert.equal(csvCell('река "Тревненска"'),'"река ""Тревненска"""'); assert.equal(csvCell(null),'""'); });
const telemetry={id:'device-001',stationId:'TRV-001',measuredAt:new Date(1800000000000).toISOString(),level:1.4,temperature:11,rain:null,battery:90,signal:80};
test('входната телеметрия получава сървърно време и произход', () => { const r=validateIngest(telemetry,station,1800000000100); assert.equal(r.source,'device'); assert.equal(r.receivedAt,new Date(1800000000100).toISOString()); });
test('бъдеща телеметрия се отказва', () => fails(() => validateIngest({...telemetry,measuredAt:new Date(1800000120000).toISOString()},station,1800000000000),400));
test('нечислово ниво и извъндиапазонен заряд се отказват', () => { fails(() => validateIngest({...telemetry,level:'1.2'},station,1800000000000),400); fails(() => validateIngest({...telemetry,battery:120},station,1800000000000),400); });
test('реална телеметрия не може да присвои SIM идентификатор', () => fails(() => validateIngest({...telemetry,id:'SIM-TRV-001-123'},station,1800000000000),400));

test('историческите измервания преди прекъсване са валидни и с правилно време', () => { const cutoff=Date.parse('2026-11-05T06:00:00Z'); const before=simulatedReading({...station,health:'offline'},cutoff-120000); assert.equal(before.measuredAt,new Date(cutoff-120000).toISOString()); assert.equal(before.quality,'valid'); assert.notEqual(before.status,'offline'); });
test('без валежомер стойността за валеж липсва', () => assert.equal(simulatedReading(station).rain,null));
test('валежомерът задава 60-минутния период', () => {const r=simulatedReading({...station,sensors:['pluvio']}); assert.equal(r.rainPeriodMinutes,60); assert.equal(typeof r.rain,'number');});
test('телеметрия без известен период на валежа се отказва', () => fails(() => validateIngest({...telemetry,rain:0},{...station,sensors:['pluvio']},1800000000000),400));
test('резервният PLS канал има независима детерминистична вариация', () => {const s={...station,sensors:['rls500','pls500']};const readings=Array.from({length:20},(_,i)=>simulatedReading(s,1800000000000+i*60000));assert.ok(readings.some(r=>r.levelBackup!==r.level));assert.ok(readings.every(r=>Math.abs(r.levelDelta)<=0.007));assert.deepEqual(readings[0],simulatedReading(s,1800000000000));});
test('липсващ PLS не създава резервни измервания', () => {const r=simulatedReading(station);assert.equal(r.levelBackup,null);assert.equal(r.levelBackupQuality,'missing');assert.equal(r.levelDelta,null);});
test('ingest приема резервно ниво само за регистриран PLS', () => {fails(()=>validateIngest({...telemetry,levelBackup:1.403},station,1800000000000),400);const r=validateIngest({...telemetry,levelBackup:1.403},{...station,sensors:['rls500','pls500']},1800000000000);assert.equal(r.levelBackup,1.403);assert.equal(r.levelDelta,0.003);});
test('разликата се изчислява сървърно и не се приема от устройството', () => {const r=validateIngest({...telemetry,levelBackup:1.397,levelDelta:999},{...station,sensors:['rls500','pls500']},1800000000000);assert.equal(r.levelDelta,-0.003);});
test('невалиден основен или резервен канал изключва изчислената разлика', () => {for(const fields of [{quality:'suspect'},{levelBackupQuality:'suspect'},{quality:'missing'}]){const r=validateIngest({...telemetry,levelBackup:1.403,...fields},{...station,sensors:['rls500','pls500']},1800000000000);assert.equal(r.levelDelta,null);}});
test('snapshot се получава от регистъра, а не от метаданни на устройството', () => {const r=validateIngest({...telemetry,stationSnapshot:{municipality:'Чужда община'}},{...station,version:7},1800000000000);assert.equal(r.stationSnapshot.municipality,'Трявна');assert.equal(r.stationSnapshot.stationVersion,7);assert.equal(r.stationSnapshot.lat,station.lat);});
test('скорост без регистриран RQ-30 се отказва', () => {fails(()=>validateIngest({...telemetry,velocity:1.2},station,1800000000000),400);assert.equal(validateIngest({...telemetry,velocity:1.2},{...station,sensors:['rls500','rq30']},1800000000000).velocity,1.2);});
test('дебитът се отказва без валидиран профил и модел', () => {fails(()=>validateIngest({...telemetry,discharge:12.3},{...station,sensors:['rls500','rq30']},1800000000000),400);fails(()=>validateIngest({...telemetry,discharge:0},station,1800000000000),400);});

const documentedSection = {
  ...emptyRiverSection(station), name:'Наблюдаван участък при контролния пункт', terrain:'mountain',
  channel:'Описание от теренен оглед.', sourceTitle:'Хидроложко становище', sourceUrl:'https://example.test/section',
  reference:'Становище RG-12', reviewedBy:'Отговорен хидролог', reviewedAt:'2026-11-01', status:'verified',
};

test('старите записи получават демопрофил само при точно съвпадаща точка, без мутация', () => {
  const example = sectionContent.profiles[0];
  const legacy = { ...station, id:example.stationId, river:example.river, lat:example.lat, lng:example.lng };
  const enriched = enrichStationMetadata(legacy);
  assert.deepEqual(enriched.riverSection, example.riverSection);
  assert.equal(legacy.riverSection, undefined);
  enriched.riverSection.name = 'Локална промяна';
  assert.equal(enrichStationMetadata(legacy).riverSection.name, example.riverSection.name);
});

test('име на река без идентични ID и координати не присвоява чужд профил', () => {
  const example = sectionContent.profiles[0];
  const legacy = { ...station, id:example.stationId, river:example.river, lat:example.lat, lng:example.lng };
  for (const change of [{id:'NEW-001'}, {lat:legacy.lat + 0.001}, {lng:legacy.lng + 0.001}, {river:'Друга река'}]) {
    const result = enrichStationMetadata({ ...legacy, ...change });
    assert.equal(result.riverSection.terrain, 'unknown');
    assert.equal(result.riverSection.status, 'draft');
    assert.equal(result.riverSection.sourceTitle, '');
  }
});

test('съхранен профил и съзнателно празни полета имат приоритет пред демонстрационния пример', () => {
  const example = sectionContent.profiles[0];
  const saved = { ...station, id:example.stationId, river:example.river, lat:example.lat, lng:example.lng, riverSection:emptyRiverSection(station) };
  saved.riverSection.channel = 'Собствен теренен запис';
  const result = enrichStationMetadata(saved);
  assert.equal(result.riverSection.channel, 'Собствен теренен запис');
  assert.equal(result.riverSection.terrain, 'unknown');
  assert.equal(result.riverSection.sourceTitle, '');
});

test('частично обновяване запазва останалите характеристики на конкретния участък', () => {
  const saved = { ...station, riverSection:{ ...emptyRiverSection(station), channel:'Скално корито', flowRegime:'Сезонен режим' } };
  const result = validateStation({riverSection:{monitoringFocus:'Контрол на покачването'}}, saved, municipal);
  assert.equal(result.riverSection.channel, 'Скално корито');
  assert.equal(result.riverSection.flowRegime, 'Сезонен режим');
  assert.equal(result.riverSection.monitoringFocus, 'Контрол на покачването');
  assert.equal(saved.riverSection.monitoringFocus, '');
});

test('черновата запазва въведените от общината данни за проверяващия при последваща редакция', () => {
  const draft = validateStation({riverSection:{reviewedBy:'Общински експерт',reviewedAt:'2026-11-01'}}, station, municipal);
  assert.equal(draft.riverSection.status, 'draft');
  assert.equal(draft.riverSection.reviewedBy, 'Общински експерт');
  assert.equal(draft.riverSection.reviewedAt, '2026-11-01');
  const changed = validateStation({riverSection:{channel:'Допълнено теренно описание'}}, draft, municipal);
  assert.equal(changed.riverSection.status, 'draft');
  assert.equal(changed.riverSection.reviewedBy, 'Общински експерт');
  assert.equal(changed.riverSection.reviewedAt, '2026-11-01');
});

test('станцията приема EXO2 от каталога без добавяне на фиктивни измервателни канали', () => {
  const result = validateStation({sensors:['rls500','pls500','exo2']}, station, admin);
  assert.deepEqual(result.sensors, ['rls500','pls500','exo2']);
  const reading = simulatedReading(result);
  for (const channel of ['pH', 'conductivity', 'turbidity', 'dissolvedOxygen']) assert.equal(Object.hasOwn(reading, channel), false);
});

test('потвърждаването изисква администратор и пълна документална препратка', () => {
  fails(() => validateStation({riverSection:documentedSection}, station, municipal), 403);
  for (const key of ['reviewedBy', 'reviewedAt', 'reference', 'sourceTitle']) {
    fails(() => validateStation({riverSection:{ ...documentedSection, [key]:'' }}, station, admin), 400);
  }
  assert.equal(validateStation({riverSection:documentedSection}, station, admin).riverSection.status, 'verified');
});

test('редакция без ново администраторско потвърждение обезсилва старата проверка', () => {
  const saved = { ...station, riverSection:documentedSection };
  for (const session of [municipal, admin]) {
    const result = validateStation({riverSection:{channel:'Изменено корито след високи води'}}, saved, session);
    assert.equal(result.riverSection.status, 'draft');
    assert.equal(result.riverSection.reviewedBy, '');
    assert.equal(result.riverSection.reviewedAt, '');
    assert.equal(result.riverSection.reference, documentedSection.reference);
  }
  const explicit = validateStation({riverSection:{channel:'Ново описание',status:'verified'}}, saved, admin);
  assert.equal(explicit.riverSection.status, 'verified');
});

test('пълен общински snapshot не превръща изменен профил в потвърден', () => {
  const saved = { ...station, riverSection:documentedSection };
  assert.equal(validateStation({riverSection:{ ...documentedSection }}, saved, municipal).riverSection.status, 'verified');
  assert.equal(validateStation({riverSection:{ ...documentedSection, channel:'Променено описание' }}, saved, municipal).riverSection.status, 'draft');
});

test('несвързана настройка запазва потвърдения речен профил', () => {
  const result = validateStation({notes:'Проверен шкаф'}, { ...station, riverSection:documentedSection }, municipal);
  assert.deepEqual(result.riverSection, documentedSection);
});

test('преместването нулира профила независимо от подадения стар snapshot', () => {
  const saved = { ...station, riverSection:documentedSection, locationStatus:'approved' };
  for (const change of [{lat:42.9}, {lng:25.5}, {river:'Янтра'}, {municipality:'Габрово'}]) {
    const result = validateStation({ ...change, riverSection:documentedSection }, saved, admin);
    assert.equal(result.locationStatus, 'proposed');
    assert.deepEqual(result.riverSection, emptyRiverSection(result));
  }
});

test('преместването запазва само изрично промененото описание като нова чернова', () => {
  const saved = { ...station, riverSection:documentedSection, locationStatus:'approved' };
  const next = {name:'Нов участък след преместването',channel:'Корито при новата точка'};
  for (const riverSection of [next, { ...documentedSection, ...next }]) {
    const result = validateStation({lat:42.9,riverSection}, saved, admin);
    assert.equal(result.locationStatus, 'proposed');
    assert.deepEqual(result.riverSection, { ...emptyRiverSection(result), ...next });
    assert.equal(result.riverSection.status, 'draft');
    assert.equal(result.riverSection.reviewedBy, '');
    assert.equal(result.riverSection.reference, '');
    assert.equal(result.riverSection.terrain, 'unknown');
  }
});

test('речният профил отхвърля непознати полета, скаларни стойности и невалидни кодове', () => {
  for (const riverSection of [null, [], 'планинска', 3, {terrain:'ocean'}, {terrain:null}, {position:12}, {position:null}, {status:'approved'}, {name:''}, {channel:7}, {isAdmin:true}, {channel:'x'.repeat(1501)}]) {
    fails(() => validateStation({riverSection}, station, admin), 400);
  }
  fails(() => validateStation({riverSection:JSON.parse('{"__proto__":{"status":"verified"}}')}, station, admin), 400);
});

test('препратките към източници приемат само пълни http(s) адреси без данни за вход', () => {
  for (const sourceUrl of ['javascript:alert(1)', 'data:text/html,test', 'ftp://example.test/file', '/report', 'https://user:password@example.test/report', 'https://exa\nmple.test']) {
    fails(() => validateStation({riverSection:{sourceUrl}}, station, admin), 400);
  }
  assert.equal(validateStation({riverSection:{sourceUrl:'https://example.test/report?q=1'}}, station, admin).riverSection.sourceUrl, 'https://example.test/report?q=1');
});

test('датата на проверката е действителна календарна дата без бъдещо потвърждение', () => {
  for (const reviewedAt of ['2026-02-29', '2026-04-31', '2026-1-01', '2026-11-01T00:00:00Z', '2099-01-01', 123]) {
    fails(() => validateStation({riverSection:{ ...documentedSection, reviewedAt }}, station, admin), 400);
  }
  assert.equal(validateStation({riverSection:{ ...documentedSection, reviewedAt:'2024-02-29' }}, station, admin).riverSection.reviewedAt, '2024-02-29');
});
