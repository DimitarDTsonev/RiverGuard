import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const source = readFileSync(new URL('lib/station-inventory.ts', root), 'utf8')
  .replace("import catalogue from './sensors-content.json';", `import catalogue from ${JSON.stringify(new URL('lib/sensors-content.json', root).href)} with {type:'json'};`);
const compiled = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {stationEquipment,sensorChannels,safeSourceUrl} = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('досието показва само оборудването на избраната станция и запазва непознатите кодове', () => {
  const equipment = stationEquipment({sensors:['pls500','pluvio','pls500','custom-001']});
  assert.deepEqual(equipment.map(item=>item.id), ['pls500','pluvio','custom-001']);
  assert.equal(equipment.find(item=>item.id==='custom-001').known,false);
  assert.ok(equipment.every(item=>item.purpose.length>0));
  assert.ok(equipment.find(item=>item.id==='custom-001').name.includes('custom-001'));
});
test('поддържащото оборудване не се брои за автоматичен датчик', () => {
  const equipment = stationEquipment({sensors:['rls500','netdl','solar','gauge','cabinet']});
  assert.deepEqual(equipment.filter(item=>item.support).map(item=>item.id), ['netdl','solar','gauge','cabinet']);
  assert.deepEqual(equipment.filter(item=>!item.support&&item.known).map(item=>item.id), ['rls500']);
});
test('празна конфигурация не се допълва автоматично с целия каталог', () => {
  assert.deepEqual(stationEquipment({sensors:[]}),[]);
});
test('липсващ пакет не създава нули или валидни измервания', () => {
  for(const id of ['rls500','pls500','pluvio','rq30']) {
    const channels=sensorChannels(id);
    assert.ok(channels.length>0);
    assert.ok(channels.every(channel=>channel.value===null&&channel.quality==='missing'));
  }
});
test('нулев валеж е измерване само при потвърден 60-минутен период', () => {
  assert.equal(sensorChannels('pluvio',{rain:0,rainPeriodMinutes:60,quality:'valid'})[0].value,0);
  assert.equal(sensorChannels('pluvio',{rain:12,rainPeriodMinutes:null,quality:'valid'})[0].value,null);
  assert.equal(sensorChannels('pluvio',{rain:null,rainPeriodMinutes:60,quality:'valid'})[0].quality,'missing');
});
test('PLS каналът запазва собственото качество и не показва радарната стойност', () => {
  const reading={level:1.4,levelBackup:1.2,temperature:9,quality:'valid',levelBackupQuality:'suspect'};
  const channels=sensorChannels('pls500',reading);
  assert.equal(channels[0].value,1.2);
  assert.equal(channels[0].quality,'suspect');
  assert.equal(sensorChannels('rls500',reading)[0].value,1.4);
  assert.equal(sensorChannels('rls500',reading)[0].quality,'valid');
});
test('EXO2 и непознат модел не получават чужди канали от пакета', () => {
  const reading={level:1.4,levelBackup:1.2,temperature:9,velocity:0.5,quality:'valid'};
  assert.deepEqual(sensorChannels('exo2',reading),[]);
  assert.deepEqual(sensorChannels('custom-001',reading),[]);
  assert.deepEqual(sensorChannels('netdl',reading),[]);
  assert.equal(stationEquipment({sensors:['exo2']})[0].known,true);
});
test('несъществуващ дебит не се извежда от налична скорост на RQ-30', () => {
  const channels=sensorChannels('rq30',{level:1.4,velocity:0.5,discharge:123,quality:'valid'});
  assert.deepEqual(channels.map(channel=>channel.unit),['m/s']);
  assert.equal(channels[0].value,0.5);
});
test('адресите в досието отказват скрипт, данни за вход и контролни знаци', () => {
  for(const url of ['javascript:alert(1)','data:text/html,test','https://user:pass@example.test/','https://example.test/\n','/relative']) assert.equal(safeSourceUrl(url),null);
  assert.equal(safeSourceUrl('https://example.test/reference'), 'https://example.test/reference');
});
