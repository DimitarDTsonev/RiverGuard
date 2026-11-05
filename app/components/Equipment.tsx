'use client';

import {useMemo, useState, type CSSProperties} from 'react';
import {ArrowRight, Check, ClipboardList, CloudRain, Download, Gauge, MapPin, Package, Plus, Printer, RadioTower, Ruler, Search, ShieldCheck, Sun, Waves, Wrench} from 'lucide-react';
import content from '../../lib/sensors-content.json';
import type {Order, Session, Station} from '../../lib/types';
import {Details, Empty, External, Fact, SectionHead, downloadBlob} from './ui';

type Standard = {name:string; status:string; evidence:string|null};
type Product = {
  id:string; name:string; category:string; manufacturer:string; application:string;
  recommendedConfiguration:string; specifications:{name:string;value:string}[];
  standards:Standard[]; constraints:string[]; priceLabel:string; warranty:string;
  sources:string[]; productUrl?:string; supplierId?:string; generic?:boolean;
};
type Props = {
  section:'pilot'|'equipment'; stations:Station[]; orders:Order[]; session:Session;
  onOrder:(productId:string)=>void; notify:(message:string)=>void;
};

const grid:CSSProperties={display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,320px),1fr))',gap:18};
const row:CSSProperties={display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'};
const muted:CSSProperties={color:'var(--muted-foreground,#6b7a87)',fontSize:13,lineHeight:1.65};
const sourceById=new Map(content.sources.map(source=>[source.id,source]));
const categoryById:Record<string,string>={rls500:'Ниво',pls500:'Ниво',pluvio:'Валеж',rq30:'Скорост и разход',netdl:'Телеметрия',solar:'Инфраструктура',gauge:'Инфраструктура',cabinet:'Инфраструктура'};
const pilotPointCount=content.pilotStationRoles.length;
const pilotSensorCounts:Record<string,number>=Object.fromEntries(content.pilotKit.sensors.map(item=>[item.productId,item.quantity]));
const pilotSensorTotal=content.pilotKit.sensors.reduce((sum,item)=>sum+item.quantity,0);
const baseCounts:Record<string,string>={...Object.fromEntries(content.pilotKit.sensors.map(item=>[item.productId,`${item.quantity} в пилота`])),rq30:'Разширение',netdl:`${pilotPointCount}; +1 при отделна площадка`};
const icons={rls500:Waves,pls500:Gauge,pluvio:CloudRain,rq30:Waves,netdl:RadioTower,solar:Sun,gauge:Ruler,cabinet:ShieldCheck};

const genericProducts:Product[]=[
  {
    id:'solar',name:'Автономно захранване',category:'Захранване',manufacturer:'Избор след енергиен разчет',generic:true,
    application:'Соларен модул, акумулатор, регулатор и защити, съобразени с всяко отделно място.',
    recommendedConfiguration:'Целева автономност поне 72 часа. Капацитетът и мощността се изчисляват за зимния режим, реалното засенчване и стареенето на батерията.',
    specifications:[{name:'Оразмеряване',value:'По зимен енергиен баланс'},{name:'Автономност',value:'≥72 h — проектна цел'},{name:'Диагностика',value:'Напрежение, заряд и състояние'},{name:'Дъждомер',value:'Подгряването се отчита отделно'}],
    standards:[{name:'Декларации на модула, регулатора и батерията',status:'За проверка след избор на конкретни модели',evidence:null},{name:'Проект за защита и монтаж',status:'За одобрение от правоспособните специалисти',evidence:null}],
    constraints:['Няма избран производител и потвърдена комплектовка.','Зимно подгряване на валежен датчик не се добавя към малка батерия без нов разчет.','Автономността се проверява при приемане на станцията.'],
    priceLabel:'По разчет и оферта',warranty:'Срокът, допустимите цикли на батерията и изключенията се попълват от действителната оферта.',sources:[]
  },
  {
    id:'gauge',name:'Водомерна рейка и репер',category:'Ръчна проверка',manufacturer:'Избор след теренен проект',generic:true,
    application:'Независим начин за проверка на показанията и обща отправна нула за двата датчика.',
    recommendedConfiguration:'По една рейка и стабилен геодезически репер на всеки речен пункт в пилота.',
    specifications:[{name:'Количество',value:`${pilotPointCount} комплекта`},{name:'Обхват',value:'Според проектните ниски и високи води'},{name:'Нула',value:'Геодезически определена'},{name:'Достъп',value:'Безопасен за ръчен отчет'}],
    standards:[{name:'ISO 4373:2022',status:'Методическа основа за заданието; не е удостоверено съответствие на неизбран продукт',evidence:'iso4373'}],
    constraints:['Нулата се документира и се проверява след изменение на конструкцията.','При високи води не се изисква опасно приближаване за ръчен отчет.'],
    priceLabel:'По проект и оферта',warranty:'Условията за рейката, закрепването и монтажната работа се уговарят отделно.',sources:['iso4373']
  },
  {
    id:'cabinet',name:'Защитен шкаф и монтаж',category:'Защита на станцията',manufacturer:'Избор след конструктивен проект',generic:true,
    application:'Шкаф, крепежи, кабелни уплътнения, защита от пренапрежение, заземяване и контрол на достъпа.',
    recommendedConfiguration:'Минимум IP66 като проектна цел за външния шкаф. Завършеният монтаж се проверява отделно.',
    specifications:[{name:'Защита на шкафа',value:'IP66 — изискване, не сертификат'},{name:'Открит монтаж',value:'UV устойчивост и ключалка'},{name:'Сигнализация',value:'Отваряне и проблем със захранването'},{name:'Закрепване',value:'По одобрен конструктивен проект'}],
    standards:[{name:'IEC 60529',status:'Основа за изисквания IP; доказателство се изисква от избрания доставчик',evidence:'iec60529'},{name:'Електрически и конструктивни документи',status:'За представяне с комплектованата оферта',evidence:null}],
    constraints:['Степента IP на отделен компонент не се пренася върху цялата станция.','IP66 не означава мълниезащита.','Регистраторът netDL 500 е с корпус IP41 и се нуждае от външен шкаф.'],
    priceLabel:'По проект и оферта',warranty:'Няма договорен срок. Доставката, монтажът и защитните компоненти се описват в гаранционния регистър.',sources:['iec60529','netdl-product']
  }
];

const catalogue:Product[]=[...content.products.filter(p=>p.id!=='exo2') as Product[],...genericProducts];

function Evidence({ids}:{ids:string[]}){
  const sources=[...new Set(ids)].map(id=>sourceById.get(id)).filter((s):s is NonNullable<typeof s>=>Boolean(s));
  return sources.length?<div style={{display:'grid',gap:8,marginTop:14}}>{sources.map(source=><External key={source.id} href={source.url}>{source.title}</External>)}</div>:null;
}

function ProductCard({product,canOrder,onOrder}:{product:Product;canOrder:boolean;onOrder:(id:string)=>void}){
  const Icon=icons[product.id as keyof typeof icons]||Package;
  return <article className="card" style={{display:'flex',flexDirection:'column',minWidth:0}}>
    <div className="card-body" style={{padding:22,flex:1}}>
      <div style={{...row,justifyContent:'space-between',marginBottom:16}}>
        <div style={{display:'grid',placeItems:'center',width:44,height:44,borderRadius:12,background:'#e9f4f1',color:'#167664'}}><Icon size={23}/></div>
        <span className="badge" style={{fontSize:11}}>{baseCounts[product.id]||(product.generic?'По проект':'Допълнение')}</span>
      </div>
      <div className="eyebrow" style={{fontSize:10,marginBottom:5}}>{product.category}</div>
      <h3 style={{fontSize:20,lineHeight:1.25,margin:'0 0 5px'}}>{product.name}</h3>
      <div style={muted}>{product.manufacturer}</div>
      <p style={{fontSize:13,lineHeight:1.7,margin:'15px 0'}}>{product.application}</p>
      <dl style={{margin:0}}>{product.specifications.slice(0,3).map(spec=><div key={spec.name} style={{display:'grid',gridTemplateColumns:'minmax(90px,0.8fr) minmax(0,1.3fr)',gap:12,padding:'8px 0',borderTop:'1px solid var(--border,#e6ebe8)',fontSize:12,lineHeight:1.6}}><dt className="muted">{spec.name}</dt><dd style={{margin:0,fontWeight:550}}>{spec.value}</dd></div>)}</dl>
      <Details title="Характеристики, стандарти и документи">
        <div className="prose" style={{fontSize:13}}>
          <p>{product.recommendedConfiguration}</p>
          {product.specifications.length>3&&<dl>{product.specifications.slice(3).map(spec=><div key={spec.name} style={{marginBottom:10}}><dt style={{fontWeight:650}}>{spec.name}</dt><dd style={{margin:0}}>{spec.value}</dd></div>)}</dl>}
          <h4>Съответствие и доказателства</h4>
          <p className="muted">Проверява се точният модел и ревизия. Методическа основа, продуктова декларация и сертификат на цялата система са различни неща.</p>
          {product.standards.map(standard=><div key={standard.name} style={{padding:'11px 0',borderTop:'1px solid var(--border,#e6ebe8)'}}><strong style={{display:'block',fontSize:12}}>{standard.name}</strong><span style={muted}>{standard.status}</span>{standard.evidence&&sourceById.has(standard.evidence)&&<div style={{marginTop:5}}><External href={sourceById.get(standard.evidence)!.url}>Източник</External></div>}</div>)}
          <h4>Условия на монтаж и експлоатация</h4>
          <ul>{product.constraints.map(item=><li key={item}>{item}</li>)}</ul>
          <h4>Гаранция</h4><p>{product.warranty}</p>
          <Evidence ids={product.sources}/>
        </div>
      </Details>
    </div>
    <div style={{...row,justifyContent:'space-between',borderTop:'1px solid var(--border,#e6ebe8)',padding:'16px 22px'}}>
      <div><strong style={{fontSize:14}}>{product.priceLabel}</strong><div style={{...muted,fontSize:11}}>Без потвърдена покупна цена</div></div>
      <button className="button secondary" disabled={!canOrder} title={canOrder?'Създай вътрешна заявка':'Заявки създават администратори и общински оператори'} onClick={()=>onOrder(product.id)}><Plus size={15}/> Заявка</button>
    </div>
  </article>;
}

function PilotSchematic(){
  return <div className="pilot-schematic" tabIndex={0} role="region" aria-label="Условна схема на пилота; на тесен екран може да се превърта хоризонтално" style={{background:'#f2f8f5',border:'1px solid #e1ece6',borderRadius:14,overflowX:'auto'}}>
    <style>{'@media print{.pilot-schematic{overflow:visible!important;break-inside:avoid}.pilot-schematic svg{min-width:0!important}}'}</style>
    <svg viewBox="0 0 820 220" role="img" aria-label="Пет предложени речни пункта: TRV-001, TRV-004, TRV-002, TRV-005 и TRV-003. Валежният канал е към TRV-001 в демонстрацията. Схемата не определя монтажни места." style={{display:'block',width:'100%',minWidth:760}}>
      <defs><pattern id="pilot-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#e2ece6" strokeWidth="0.6"/></pattern></defs>
      <rect width="820" height="220" fill="url(#pilot-grid)"/>
      <path d="M-20 152 C50 152,55 116,100 126 S208 154,255 137 S355 91,410 115 S522 139,565 112 S663 81,720 98 S796 115,850 76" stroke="#d4e7e0" strokeWidth="38" fill="none"/>
      <path d="M-20 152 C50 152,55 116,100 126 S208 154,255 137 S355 91,410 115 S522 139,565 112 S663 81,720 98 S796 115,850 76" stroke="#7cb7aa" strokeWidth="2" strokeDasharray="5 6" fill="none"/>
      {[[100,126,'TRV-001','Горен участък'],[255,137,'TRV-004','Южен допълнителен'],[410,115,'TRV-002','Градски участък'],[565,112,'TRV-005','Северен допълнителен'],[720,98,'TRV-003','Долен участък']].map(([x,y,id,label])=><g key={String(id)}><circle cx={Number(x)} cy={Number(y)} r="15" fill="#fff" stroke="#197a67" strokeWidth="2"/><circle cx={Number(x)} cy={Number(y)} r="5" fill="#197a67"/><text x={Number(x)} y={Number(y)+34} textAnchor="middle" fill="#255548" fontSize="12" fontFamily="Arial,sans-serif" fontWeight="700">{id}</text><text x={Number(x)} y={Number(y)+53} textAnchor="middle" fill="#607969" fontSize="12" fontFamily="Arial,sans-serif">{label}</text></g>)}
      <rect x="25" y="45" width="220" height="38" rx="8" fill="#fff" stroke="#d8e7de"/><text x="135" y="69" textAnchor="middle" fill="#426c5c" fontSize="12" fontFamily="Arial,sans-serif">Валежен канал · TRV-001</text>
      <path d="M100 83 L100 109" stroke="#9db8aa" strokeDasharray="3 4"/><text x="22" y="24" fill="#779386" fontSize="10" fontFamily="Arial,sans-serif">СХЕМА НА НАБЛЮДЕНИЕТО · НЕ Е ТЕРЕНЕН ПРОЕКТ</text>
    </svg>
  </div>;
}

export default function Equipment({section,stations,orders,session,onOrder,notify}:Props){
  const [search,setSearch]=useState('');
  const [category,setCategory]=useState('Всички');
  const canOrder=session.role==='admin'||session.role==='municipal';
  const canOrderTryavna=canOrder&&(session.role==='admin'||session.municipality==='Трявна');
  const tryavna=stations.filter(station=>station.municipality==='Трявна');
  const filtered=useMemo(()=>catalogue.filter(product=>(category==='Всички'||categoryById[product.id]===category)&&`${product.name} ${product.category} ${product.manufacturer} ${product.application}`.toLocaleLowerCase('bg').includes(search.toLocaleLowerCase('bg'))),[search,category]);
  const requestCount=orders.filter(order=>session.role==='admin'||order.municipality===session.municipality).length;
  function exportSpecification(){
    const payload={project:content.project,reviewedAt:content.reviewedAt,status:content.status,pilot:content.pilotKit,stationRoles:content.pilotStationRoles,stations:tryavna.map(({id,name,river,municipality,lat,lng,locationStatus,sensors,interval,transmitInterval,riverSection})=>({id,name,river,municipality,lat,lng,locationStatus,sensors,interval,transmitInterval,riverSection})),products:catalogue,placement:content.installationWorkflow,measurements:content.measurementPolicy,sources:content.sources.map(({id,title,url})=>({id,title,url}))};
    downloadBlob(new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'}),'RiverGuard_Tryavna_specification.json');
    notify('Спецификацията е изтеглена. Комплектовката и местата подлежат на одобрение.');
  }

  if(section==='pilot') return <div style={{display:'grid',gap:22}}>
    <SectionHead eyebrow="ПИЛОТЕН РЕГИОН / ГАБРОВО" title="Пилот „Трявна“" description={`${tryavna.length} станции в община Трявна. Два независими принципа за ниво в базовия комплект. Една обща картина.`} actions={<><button className="button secondary" onClick={exportSpecification}><Download size={16}/> Спецификация</button><button className="button secondary" onClick={()=>window.print()}><Printer size={16}/> Печат</button></>}/>

    <section className="card" style={{background:'#143c35',color:'#f2faf6',border:0,overflow:'hidden'}}>
      <div style={{padding:26,display:'flex',gap:28,justifyContent:'space-between',flexWrap:'wrap'}}>
        <div style={{maxWidth:570}}><div style={{fontSize:10,letterSpacing:'0.14em',color:'#9cd3bc',fontWeight:700,marginBottom:11}}>ОСНОВНА КОМПЛЕКТОВКА · {content.pilotKit.sensors.map(item=>item.quantity).join(' + ')}</div><h2 style={{fontSize:25,lineHeight:1.25,margin:'0 0 12px',color:'#f2faf6'}}>Подготвен за теренен анализ</h2><p style={{fontSize:14,lineHeight:1.75,color:'#d5e6dd',margin:0}}>Основното ниво се следи с радар, а потопена сонда дава независимо резервно измерване и температура на водата. Местата, монтажът и праговете се утвърждават от специалистите и общината.</p></div>
        <div style={{display:'flex',gap:30,alignItems:'center',flexWrap:'wrap'}}>{[[pilotPointCount,'речни пункта'],[pilotSensorCounts.rls500+pilotSensorCounts.pls500,'датчика за ниво'],[pilotSensorCounts.pluvio,'дъждомер']].map(([value,label])=><div key={label}><div style={{fontSize:38,fontWeight:600,lineHeight:1.2,fontVariantNumeric:'tabular-nums'}}>{String(value).padStart(2,'0')}</div><div style={{fontSize:11,color:'#b6d2c4',marginTop:5}}>{label}</div></div>)}</div>
      </div>
    </section>

    <PilotSchematic/>

    <div style={grid}>{content.pilotStationRoles.map(place=>{
      const station=tryavna.find(s=>s.id===place.id);
      const locationLabel=!station?'Не е в регистъра за община Трявна':station.locationStatus==='approved'?'Одобрено в демонстрацията':station.locationStatus==='reviewed'?'Разгледано в демонстрацията':'Предложено място';
      const sensorIds=station?.sensors??place.sensors;
      return <article className="card" key={place.id}><div className="card-body" style={{padding:21}}><div style={{...row,justifyContent:'space-between',marginBottom:14}}><span className="eyebrow">{place.id}</span><MapPin size={17} color="#648577"/></div><h3 style={{fontSize:18,margin:'0 0 9px'}}>{station?.name??place.name}</h3><p style={{fontSize:13,lineHeight:1.7,minHeight:44}}>{place.purpose}</p><div style={{...row,margin:'15px 0'}}>{sensorIds.map(id=><span className="badge" key={id}>{content.products.find(product=>product.id===id)?.name??id}</span>)}</div>{!station&&<p className="muted" style={{fontSize:11}}>Показан е предложеният комплект от каталога.</p>}<div style={{borderTop:'1px solid var(--border,#e6ebe8)',paddingTop:13,fontSize:12}}><span style={{display:'inline-flex',alignItems:'center',gap:6,color:'#85651c'}}><span style={{width:6,height:6,background:'#b99748',borderRadius:'50%'}}/>{locationLabel}</span><p className="muted" style={{fontSize:11,margin:'7px 0 0'}}>Координатите на картата са примерни. Теренният протокол и одобренията се управляват в „Станции“.</p></div></div></article>;
    })}</div>

    <div className="content-grid" style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,360px),1fr))',gap:22}}>
      <section className="card"><div className="card-header"><div><div className="eyebrow">КОМПЛЕКТОВКА</div><h2>Измервателното ядро</h2></div><Package size={20}/></div><div className="table-wrap"><table><thead><tr><th>Оборудване</th><th>Брой</th><th>Роля</th><th aria-label="Действие"/></tr></thead><tbody>{content.pilotKit.sensors.map(item=>{const product=catalogue.find(p=>p.id===item.productId)!;return <tr key={item.productId}><td><strong>{product.name}</strong></td><td>{item.quantity}</td><td style={{fontSize:12}}>{item.scope}</td><td><button className="button secondary" disabled={!canOrderTryavna} title={canOrderTryavna?'Заявка за оборудване за Трявна':'Заявка за Трявна може да създаде администратор или оператор на общината'} onClick={()=>onOrder(item.productId)}><Plus size={14}/><span>Заяви</span></button></td></tr>})}</tbody></table></div><div className="card-body" style={{padding:20}}><p className="muted" style={{fontSize:12,lineHeight:1.7}}>Основният комплект съдържа {pilotSensorTotal} физически измервателни устройства. Температурата идва от {pilotSensorCounts.pls500} сонди PLS 500. Регистратори, комуникации, захранване и монтаж са отделни части от станцията.</p><Details title="Пълна инфраструктура и резерви"><div className="prose">{content.pilotKit.infrastructure.map(item=><div key={item.item} style={{marginBottom:15}}><strong>{item.item} · {item.quantity}</strong><p>{item.purpose}</p></div>)}<h4>Препоръчан резерв</h4><ul>{content.pilotKit.recommendedSpares.map(item=><li key={item.item}>{item.quantity} × {item.item}</li>)}</ul></div></Details></div></section>

      <section className="card"><div className="card-header"><div><div className="eyebrow">ИНЖЕНЕРНО ОСНОВАНИЕ</div><h2>Съобразено с речния участък</h2></div><Waves size={21}/></div><div className="card-body prose" style={{padding:22,fontSize:13}}><div style={{display:'grid',gap:17}}>{[
        ['Безконтактно основно ниво','Радарът е извън водата. Мястото се избира така, че пяна, мостови опори, наноси и плаващи предмети да не компрометират показанията.'],
        ['Резервен принцип, обща нула','Хидростатичната сонда дава независимо сравнение. Двата канала се привеждат към един геодезически репер и запазват собствените си стойности.'],
        ['Валеж с известна представителност','Един дъждомер е началният обхват. Специалист определя площадката и дали допълнителни валежни пунктове са необходими за водосбора.'],
        ['Работа през зимата','Засенчване, лед и подгряване участват в енергийния проект. Капацитетът на батерията се доказва с изпитване.']
      ].map(([title,text])=><div key={title} style={{display:'grid',gridTemplateColumns:'22px 1fr',gap:11}}><Check size={17} color="#2c8064" style={{marginTop:3}}/><div><strong>{title}</strong><p style={{margin:'5px 0 0',...muted}}>{text}</p></div></div>)}</div><Details title="Какво остава за теренния доклад"><ul>{content.installationWorkflow.requiredRecords.map(item=><li key={item}>{item}</li>)}</ul></Details></div></section>
    </div>

    <section className="card"><div className="card-header"><div><div className="eyebrow">ВРЕМЕ И КАЧЕСТВО</div><h2>Как се четат измерванията</h2></div><RadioTower size={20}/></div><div className="card-body" style={{padding:22}}><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:18,marginBottom:20}}><Fact label="Демонстрационен интервал" value={tryavna[0]?.interval||60} unit="сек."/><Fact label="Предаване в демонстрацията" value={tryavna[0]?.transmitInterval||60} unit="сек."/><Fact label="Валеж: интензитет RT" value="< 1" unit="мин. закъснение"/><Fact label="Валеж: количество NRT" value="≈ 5" unit="мин. закъснение"/></div><div className="notice"><strong>Ново опресняване ≠ ново измерване.</strong> Времето на измерване и времето на приемане се показват отделно. Липсващи данни не означават нулево ниво или безопасно състояние.</div><Details title="Предложен режим за действителните станции"><div className="prose"><p>За изпитване се предлага локална проба през 10 секунди, минутен агрегат с минимум и максимум и предаване през 60 секунди. При събитие може да се включи по-често предаване, след проверка на оборудването, връзката и автономността. Това е предложение за техническото задание; демонстрацията използва интервалите от конфигурацията на станциите.</p><p>{content.measurementPolicy.dischargeRule}</p><Evidence ids={['pluvio-manual','iso18320']}/></div></Details></div></section>

    <section className="card"><div className="card-header"><div><div className="eyebrow">РАЗШИРЕНИЯ И МЕСТЕН КОНТЕКСТ</div><h2>Следващи решения за обсъждане</h2></div></div><div className="card-body prose" style={{padding:22,fontSize:13}}><div style={grid}><div><h3>Скорост и воден разход</h3><p>RQ-30+ може да допълни пилота след заснемане на сечението и контролни измервания. Разходът се обозначава като изчислен и носи версия на модела.</p>{canOrderTryavna&&<button className="button secondary" onClick={()=>onOrder('rq30')}>Заявка за техническа оценка <ArrowRight size={15}/></button>}</div><div><h3>Качество на водата</h3><p>pH, мътност, проводимост и кислород са отделен обхват, например с YSI EXO2. Нужни са бюджет за поддръжка, калибриране и програма за пробовземане.</p><External href="https://www.ysi.com/exo2">Възможно разширение</External></div><div><h3>Река и микроязовир</h3><p>Общината обсъжда мониторинг по Тревненска. Локалното оповестяване на микроязовир „Трявна“ е отделна задача и не се приема за изпълнено от този пилот.</p><External href={sourceById.get('tryavna-2026')!.url}>Публикация на общината · 03.08.2026</External></div></div><Details title="Проверени източници и граници на предложението"><ul>{content.limitations.map(item=><li key={item}>{item}</li>)}</ul><Evidence ids={['tryavna-2026','gabrovo-risk-2026','rls-manual','pls-datasheet','pluvio-manual','iso4373','iso18320','iso748','wmo-2024']}/></Details></div></section>
  </div>;

  return <div style={{display:'grid',gap:22}}>
    <SectionHead eyebrow="ДОСТАВКИ / ОБОРУДВАНЕ" title="Каталог и партньори" description="Проверени продуктови предложения, технически документи и условия за обслужване." actions={<><span className="badge">{requestCount} вътрешни заявки</span><button className="button secondary" onClick={()=>window.print()}><Printer size={16}/> Печат</button></>}/>

    <div className="notice" style={{display:'flex',gap:12,alignItems:'flex-start'}}><ClipboardList size={19} style={{flexShrink:0,marginTop:2}}/><div><strong>Заявката започва процес по избор и одобрение.</strong><p style={{margin:'4px 0 0',fontSize:13}}>Производителите са потенциални доставчици. Цените, сроковете, гаранциите за точния вариант и договорът се потвърждават преди покупка. {session.role==='municipal'?`Вашите заявки са ограничени до община ${session.municipality}.`:session.role==='admin'?'Администраторът може да създава заявки за всички общини.':'За създаване на заявка е нужна роля администратор или общински оператор.'}</p></div></div>

    <div style={{...row,justifyContent:'space-between',gap:14}}>
      <label style={{position:'relative',display:'flex',alignItems:'center',flex:'1 1 280px',maxWidth:420}}><Search size={17} style={{position:'absolute',left:13,color:'#758478'}}/><input type="search" aria-label="Търсене в оборудването" placeholder="Търси сензор, модел или производител…" value={search} onChange={event=>setSearch(event.target.value)} style={{width:'100%',padding:'11px 13px 11px 40px',border:'1px solid var(--border,#dce4df)',borderRadius:9,background:'var(--card,#fff)',fontSize:13}}/></label>
      <label style={{...row,fontSize:12,color:'#637267'}}>Категория<select aria-label="Категория на оборудването" value={category} onChange={event=>setCategory(event.target.value)} style={{minWidth:165,padding:'10px 13px',border:'1px solid var(--border,#dce4df)',borderRadius:9,background:'var(--card,#fff)',fontSize:13}}>{['Всички','Ниво','Валеж','Скорост и разход','Телеметрия','Инфраструктура'].map(option=><option key={option}>{option}</option>)}</select></label>
      <span className="muted" style={{fontSize:12}}>{filtered.length} предложения</span>
    </div>
    {filtered.length?<div style={grid}>{filtered.map(product=><ProductCard key={product.id} product={product} canOrder={canOrder} onOrder={onOrder}/>)}</div>:<Empty title="Няма съвпадащо оборудване" description="Променете думата за търсене или изберете друга категория."/>}

    <section style={{marginTop:12}}><div style={{...row,justifyContent:'space-between',marginBottom:17}}><div><div className="eyebrow">ПРОИЗВОДИТЕЛИ И ОБСЛУЖВАНЕ</div><h2 style={{fontSize:22,margin:'6px 0'}}>Кой стои зад оборудването</h2></div><span className="badge">Без заявени сключени договори</span></div><div style={grid}>{content.suppliers.map(supplier=><article key={supplier.id} className="card"><div className="card-body" style={{padding:22}}><div style={{...row,justifyContent:'space-between'}}><span className="eyebrow">{supplier.country}</span><Wrench size={17} color="#688478"/></div><h3 style={{fontSize:19,margin:'12px 0 6px'}}>{supplier.name}</h3><p style={{...muted,fontSize:11}}>{supplier.status}</p><p style={{fontSize:13,lineHeight:1.7}}>{supplier.warranty}</p><Details title="При повреда и претенция"><div className="prose" style={{fontSize:13}}><h4>Сервизен процес</h4><p>{supplier.incidentProcess}</p><h4>Компенсации</h4><p>{supplier.compensation}</p><p>{supplier.contact}</p><Evidence ids={supplier.evidence}/></div></Details><div style={{marginTop:15}}><External href={supplier.website}>Официален производител</External></div></div></article>)}</div></section>

    <div style={grid}>
      <section className="card"><div className="card-header"><div><div className="eyebrow">ГАРАНЦИОННО ДОСИЕ</div><h2>За всяка реална доставка</h2></div><ShieldCheck size={20}/></div><div className="card-body prose" style={{padding:22,fontSize:13}}><p>При получаване се свързват сериен номер, станция, доставчик, договор и гаранционен срок. При повреда сервизният случай пази доказателствата и договорното основание.</p><ul><li>Начална и крайна дата на гаранцията, изключения и ред за уведомяване.</li><li>Кой плаща демонтаж, транспорт, заместващо устройство и повторно калибриране.</li><li>Срокове за реакция и ремонт, измерими по конкретно споразумение.</li><li>Компенсация само по приложима клауза; дефектът не поражда автоматично обезщетение за всички последици.</li></ul><p className="muted">Стандартната производствена гаранция и договорът за поддръжка имат различен обхват.</p></div></section>
      <section className="card"><div className="card-header"><div><div className="eyebrow">ДОКАЗАТЕЛСТВА ЗА СЪОТВЕТСТВИЕ</div><h2>Документ, версия, приложение</h2></div><ClipboardList size={20}/></div><div className="card-body prose" style={{padding:22,fontSize:13}}><p>Каталогът показва кои твърдения са проследени до официален документ и кои са изисквания към бъдещата доставка.</p>{content.standardsGuide.map(standard=><Details key={standard.name} title={standard.name}><p>{standard.purpose}</p><p className="muted">{standard.status}</p><Evidence ids={[standard.source]}/></Details>)}<p className="muted">Проверка на източниците: 05.11.2026 г. Съответствието се сверява повторно при оферта и приемане.</p></div></section>
    </div>
  </div>;
}
