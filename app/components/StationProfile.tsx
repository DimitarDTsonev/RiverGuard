'use client';

import {useState} from 'react';
import {ArrowRight, BookOpen, CloudRain, FileCheck2, Gauge, MapPin, Mountain, Package, RadioTower, Settings2, ShieldCheck, Waves} from 'lucide-react';
import type {RiverSection, Station} from '../../lib/types';
import riverContent from '../../lib/river-sections-content.json';
import {safeSourceUrl, sensorChannels, stationEquipment, type StationEquipment} from '../../lib/station-inventory';
import {Badge, Details, External, Fact, Field, dateTime, num} from './ui';
import './station-profile.css';

export const terrainLabels: Record<RiverSection['terrain'], string> = {
  mountain: 'Планински участък', foothill: 'Полупланински участък', lowland: 'Равнинен участък',
  mixed: 'Преходен / смесен участък', unknown: 'Релефът предстои да се определи',
};
export const positionLabels: Record<RiverSection['position'], string> = {
  upper: 'Горно течение', middle: 'Средно течение', lower: 'Долно течение', unknown: 'Положението по течението не е уточнено',
};

function sectionOf(station?: Station): RiverSection {
  return station?.riverSection || {
    name: station ? `${station.river} · ${station.name}` : '', position: 'unknown', terrain: 'unknown',
    channel: '', flowRegime: '', floodRisks: '', monitoringFocus: '', waterBodyCode: '', typologyCode: '',
    status: 'draft', sourceTitle: '', sourceUrl: '', reference: '', reviewedBy: '', reviewedAt: '',
  };
}

function todayInSofia(): string {
  const parts = new Intl.DateTimeFormat('en', {timeZone: 'Europe/Sofia', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

const qualityLabels = {valid: 'Валиден запис', suspect: 'За проверка', missing: 'Липсва / неизползваемо'};
const icons: Record<string, typeof Waves> = {rls500: Waves, pls500: Gauge, pluvio: CloudRain, rq30: Waves, netdl: RadioTower};

function EquipmentCard({equipment, station}: {equipment: StationEquipment; station: Station}) {
  const Icon = icons[equipment.id] || Package;
  const channels = sensorChannels(equipment.id, station.current);
  const productUrl = safeSourceUrl(equipment.productUrl);
  const hasReading = channels.some(channel => channel.value !== null);
  return <article className={`station-equipment-card ${equipment.support ? 'is-support' : ''}`}>
    <div className="station-equipment-heading">
      <span className="station-profile-icon"><Icon size={20}/></span>
      <div><p className="station-profile-kicker">{equipment.category}</p><h4>{equipment.name}</h4><p className="station-profile-maker">{equipment.manufacturer}</p></div>
    </div>
    <p className="station-equipment-purpose">{equipment.purpose}</p>
    {channels.length > 0 && <div className="station-sensor-channels">
      <p className="station-profile-kicker">Канали в RiverGuard</p>
      {channels.map(channel => <div className="station-sensor-channel" key={channel.label}>
        <Fact label={channel.label} value={num(channel.value, channel.unit === 'm' ? 3 : 1)} unit={channel.unit}/>
        <Badge status={channel.quality === 'valid' ? 'normal' : channel.quality === 'suspect' ? 'warning' : 'offline'}>{qualityLabels[channel.quality]}</Badge>
      </div>)}
      {hasReading && station.current ? <div className="station-sensor-time">
        <span>{station.current.source === 'simulated' ? 'Учебни показания' : 'Телеметрия от устройство'}</span>
        <span>Време на измерване в пакета: {dateTime(station.current.measuredAt)}</span>
        <span>Получен пакет: {dateTime(station.current.receivedAt)}</span>
        {(station.current.status === 'offline' || station.current.status === 'maintenance') && <strong>Последен наличен пакет · {station.current.status === 'offline' ? 'няма връзка' : 'поддръжка'}</strong>}
      </div> : <p className="station-profile-muted">Няма получени стойности за тези канали.</p>}
    </div>}
    {equipment.id === 'rq30' && <p className="station-profile-note">Дебит не се публикува: за този прототип не е въведен валидиран модел на измервателното сечение.</p>}
    {equipment.id === 'exo2' && <p className="station-profile-note">Интерфейсът за приемане на данни още не съдържа канали за тази сонда. Наличието ѝ в списъка не създава измервания за качество на водата.</p>}
    {equipment.support && <p className="station-profile-muted">Поддържащо оборудване · не е отделен автоматичен измервателен канал.</p>}
    {(equipment.parameters.length > 0 || equipment.constraints.length > 0 || productUrl) && <Details title="Възможности и условия на модела">
      {equipment.parameters.length > 0 && <>
        <p className="station-profile-muted">Каталожни възможности. Достъпността зависи от конфигурацията и свързаните канали.</p>
        <ul className="station-parameter-list">{equipment.parameters.map(parameter => <li key={parameter}>{parameter}</li>)}</ul>
      </>}
      {equipment.constraints.length > 0 && <ul className="station-constraint-list">{equipment.constraints.map(constraint => <li key={constraint}>{constraint}</li>)}</ul>}
      {productUrl && <External href={productUrl}>Документация на производителя</External>}
    </Details>}
  </article>;
}

function RiverExamples({river}: {river: string}) {
  const examples = riverContent.examples.filter(example => example.river === river);
  if (!examples.length) return null;
  return <Details title="Същата река, различни участъци">
    <p className="station-profile-muted">Справка за райони по течението. Примерите не обозначават допълнителни инсталирани станции.</p>
    <div className="station-river-examples">{examples.map(example => {
      const source = riverContent.sources.find(item => item.id === example.sourceId);
      const url = safeSourceUrl(source?.url);
      return <article key={example.id}>
        <h4>{example.name}</h4>
        <p className="station-profile-kicker">{terrainLabels[example.terrain as RiverSection['terrain']] || terrainLabels.unknown}{example.typologyCode ? ` · ${example.typologyCode}` : ''}</p>
        <p>{example.description}</p>
        {url && <External href={url}>{source?.title || 'Източник'}</External>}
      </article>;
    })}</div>
  </Details>;
}

export function StationProfile({station, onEdit, onEquipment}: {station: Station; onEdit?: () => void; onEquipment?: () => void}) {
  const inventory = stationEquipment(station);
  const sensors = inventory.filter(equipment => equipment.known && !equipment.support);
  const supporting = inventory.filter(equipment => equipment.support);
  const unknown = inventory.filter(equipment => !equipment.known);
  const section = sectionOf(station);
  const sourceUrl = safeSourceUrl(section.sourceUrl);
  const sectionFields = [
    ['Корито и местни особености', section.channel],
    ['Воден режим', section.flowRegime],
    ['Рискове за наблюдение', section.floodRisks],
    ['Цел на наблюдението в този участък', section.monitoringFocus],
  ];
  return <div className="station-profile">
    <header className="station-profile-heading">
      <div><p className="station-profile-kicker">ДОСИЕ НА СТАНЦИЯ · {station.id}</p><h2>{station.name}</h2><p className="station-profile-location"><MapPin size={15}/>р. {station.river} · община {station.municipality} · област {station.oblast}</p></div>
      {onEdit && <button type="button" className="button secondary" onClick={onEdit}><Settings2 size={15}/>Редактирай профила</button>}
    </header>
    <div className="station-profile-context"><RadioTower size={18}/><p><strong>Демонстрационна конфигурация.</strong> Списъкът описва оборудването, зададено за този пункт. Реалният монтаж, серийните номера и приемането се удостоверяват в техническото досие.</p></div>

    <section aria-labelledby={`sensors-heading-${station.id}`}>
      <div className="station-profile-section-head"><div><h3 id={`sensors-heading-${station.id}`}>Конфигурирани датчици <span className="station-profile-count">{sensors.length}</span></h3><p>Модел, предназначение и налични канали за тази станция.</p></div>{onEquipment && <button type="button" className="text-button" onClick={onEquipment}>Към каталога <ArrowRight size={14}/></button>}</div>
      {sensors.length ? <div className="station-equipment-grid">{sensors.map(equipment => <EquipmentCard key={equipment.id} equipment={equipment} station={station}/>)}</div> : <p className="station-profile-empty">Няма конфигурирани автоматични датчици.</p>}
      {supporting.length > 0 && <div className="station-support-section"><h3>Поддържащо оборудване <span className="station-profile-count">{supporting.length}</span></h3><div className="station-equipment-grid">{supporting.map(equipment => <EquipmentCard key={equipment.id} equipment={equipment} station={station}/>)}</div></div>}
      {unknown.length > 0 && <div className="station-support-section"><h3>Оборудване за уточняване <span className="station-profile-count">{unknown.length}</span></h3><div className="station-equipment-grid">{unknown.map(equipment => <EquipmentCard key={equipment.id} equipment={equipment} station={station}/>)}</div></div>}
    </section>

    <section className="station-river-section" aria-labelledby={`river-heading-${station.id}`}>
      <div className="station-profile-section-head"><div><p className="station-profile-kicker">РЕКАТА ПРИ СТАНЦИЯТА</p><h3 id={`river-heading-${station.id}`}>Речен участък</h3></div><Badge status={section.status === 'verified' ? 'normal' : 'proposed'}>{section.status === 'verified' ? 'Експертно проверен профил' : 'Работен профил · за експертна проверка'}</Badge></div>
      <h4 className="station-river-name">{section.name || `${station.river} · ${station.name}`}</h4>
      <div className="station-river-traits"><span><Mountain size={17}/>{terrainLabels[section.terrain] || terrainLabels.unknown}</span><span><Waves size={17}/>{positionLabels[section.position] || positionLabels.unknown}</span></div>
      <p className="station-profile-muted">Характеристиките се отнасят за наблюдавания участък. Положението по течението, релефът и официалната типология се описват отделно.</p>
      <div className="station-river-description">{sectionFields.map(([label, value]) => <div key={label}><h4>{label}</h4><p className={value ? '' : 'station-profile-muted'}>{value || 'Предстои описание след теренен и документален преглед.'}</p></div>)}</div>
      <dl className="station-river-metadata">
        <div><dt>Код на водното тяло</dt><dd>{section.waterBodyCode || 'Не е потвърден за този пункт'}</dd></div>
        <div><dt>Официален тип на водното тяло</dt><dd>{section.typologyCode || 'Не е потвърден за този пункт'}</dd></div>
        <div><dt>Източник на описанието</dt><dd>{sourceUrl ? <External href={sourceUrl}>{section.sourceTitle || 'Документ за участъка'}</External> : section.sourceTitle || 'Предстои да се приложи източник'}</dd></div>
        <div><dt>Документ / експертно становище</dt><dd>{section.reference || 'Не е въведено'}</dd></div>
        <div><dt>Експерт, извършил прегледа</dt><dd>{section.reviewedBy || 'Не е въведен'}</dd></div>
        <div><dt>Дата на експертния преглед</dt><dd>{section.reviewedAt ? section.reviewedAt.split('-').reverse().join('.') : 'Не е въведена'}</dd></div>
      </dl>
      <p className="station-profile-note"><FileCheck2 size={17}/><span>Водното ниво и дебитът са различни величини. Описанието на участъка не заменя измерен дебит или валидирана зависимост между ниво и дебит. Съгласуването на мястото за монтаж остава отделна процедура.</span></p>
      <RiverExamples river={station.river}/>
    </section>
  </div>;
}

export function StationProfileSummary({station, onOpen}: {station: Station; onOpen: () => void}) {
  const inventory = stationEquipment(station);
  const sensors = inventory.filter(equipment => equipment.known && !equipment.support);
  const unknownCount = inventory.filter(equipment => !equipment.known).length;
  const section = sectionOf(station);
  return <div className="station-profile-summary">
    <div><span><RadioTower size={14}/>Датчици в станцията</span><p>{sensors.length ? sensors.map(sensor => sensor.name).join(' · ') : 'Няма описани автоматични датчици'}{unknownCount > 0 && ` · ${unknownCount} идентификатора за уточняване`}</p></div>
    <div><span><Waves size={14}/>Речен участък</span><p>{terrainLabels[section.terrain] || terrainLabels.unknown}{section.position !== 'unknown' ? ` · ${positionLabels[section.position]}` : ''}<small>{section.status === 'verified' ? 'Експертно проверен профил' : 'Работен профил · за експертна проверка'}</small></p></div>
    <button type="button" className="button secondary full" onClick={onOpen}><BookOpen size={15}/>Досие на станцията <ArrowRight size={14}/></button>
  </div>;
}

export function RiverSectionFields({station, canVerify}: {station?: Station; canVerify: boolean}) {
  const section = sectionOf(station);
  const [status, setStatus] = useState(section.status);
  return <fieldset className="station-river-fields">
    <legend><Waves size={17}/>Профил на речния участък</legend>
    <p className="station-profile-muted">Опишете реката при тази станция. За неизвестна характеристика изберете „Неуточнено“ или оставете полето празно. При промяна на река, координати или община старите характеристики и потвърждението се изчистват. Въведените в същата редакция нови характеристики се запазват като работен профил.</p>
    <Field label="Наименование на речния участък"><input name="section_name" maxLength={160} defaultValue={section.name} placeholder="Напр. Тунджа · градски участък при Ямбол"/></Field>
    <div className="form-grid">
      <Field label="Положение по течението"><select name="section_position" defaultValue={section.position}><option value="unknown">Неуточнено</option><option value="upper">Горно течение</option><option value="middle">Средно течение</option><option value="lower">Долно течение</option></select></Field>
      <Field label="Характер на местния релеф"><select name="section_terrain" defaultValue={section.terrain}><option value="unknown">Неуточнено</option><option value="mountain">Планински</option><option value="foothill">Полупланински</option><option value="lowland">Равнинен</option><option value="mixed">Преходен / смесен</option></select></Field>
    </div>
    <Field label="Корито и местни особености" hint="Опишете коритото, ръкавите, мостовете, наносите и други особености по налични данни."><textarea name="section_channel" rows={3} maxLength={1500} defaultValue={section.channel}/></Field>
    <Field label="Воден режим" hint="Обичайно поведение, сезонност и влияние на регулиране. Числен дебит се посочва само с измерване и източник."><textarea name="section_flowRegime" rows={3} maxLength={1500} defaultValue={section.flowRegime}/></Field>
    <Field label="Рискове за наблюдение"><textarea name="section_floodRisks" rows={3} maxLength={1500} defaultValue={section.floodRisks} placeholder="Напр. бързо покачване, подпиране, затлачване — след оценка за конкретното място."/></Field>
    <Field label="Цел на наблюдението в този участък"><textarea name="section_monitoringFocus" rows={2} maxLength={1500} defaultValue={section.monitoringFocus}/></Field>
    <div className="form-grid">
      <Field label="Код на водното тяло"><input name="section_waterBodyCode" maxLength={80} defaultValue={section.waterBodyCode} placeholder="Само след пространствена проверка"/></Field>
      <Field label="Официален код на речния тип"><input name="section_typologyCode" maxLength={40} defaultValue={section.typologyCode} placeholder="Напр. R3 — с документален източник"/></Field>
    </div>
    <Field label="Наименование на източника"><input name="section_sourceTitle" maxLength={300} defaultValue={section.sourceTitle}/></Field>
    <Field label="Адрес на източника"><input name="section_sourceUrl" type="url" maxLength={1500} defaultValue={section.sourceUrl} placeholder="https://…"/></Field>
    <Field label="Документ / експертно становище"><input name="section_reference" maxLength={500} defaultValue={section.reference} placeholder="Номер, дата, орган и обхват на становището"/></Field>
    <div className="form-grid">
      <Field label="Експерт, извършил прегледа"><input name="section_reviewedBy" maxLength={160} defaultValue={section.reviewedBy}/></Field>
      <Field label="Дата на експертния преглед"><input name="section_reviewedAt" type="date" defaultValue={section.reviewedAt} max={todayInSofia()}/></Field>
    </div>
    {canVerify ? <div className="station-verification-fields">
      <Field label="Статус на профила"><select name="section_status" value={status} onChange={event => setStatus(event.target.value as RiverSection['status'])}><option value="draft">Работен профил · за експертна проверка</option><option value="verified">Експертно проверен профил</option></select></Field>
      <label className="station-confirmation"><input type="checkbox" name="section_confirm" value="yes" disabled={status !== 'verified'}/><span>Потвърждавам профила след тази редакция</span></label>
      <p className="station-profile-muted"><ShieldCheck size={15}/>При промяна на проверено съдържание е нужно ново изрично потвърждение. За потвърден профил попълнете източник, експерт, дата и документ. Промяна само на общите настройки запазва съществуващия статус.</p>
    </div> : <p className="station-profile-note">Промените по характеристиките се запазват като работен профил за експертна проверка. Потвърждението се регистрира от администратор.</p>}
  </fieldset>;
}

export default StationProfile;
