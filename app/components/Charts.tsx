'use client';
import {useId,useState} from 'react';
import type {Reading} from '../../lib/types';
import {num,timeOnly} from './ui';
export function Spark({values,color='#258d73'}:{values:number[];color?:string}){const min=Math.min(...values)-.1,max=Math.max(...values)+.1;const d=values.map((v,i)=>`${i?'L':'M'}${i/(values.length-1)*100},${32-(v-min)/(max-min)*28}`).join(' ');return <svg className="spark" viewBox="0 0 100 38" aria-hidden="true"><path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round"/><path d={`${d} L100,38 L0,38 Z`} fill={color} opacity=".07"/></svg>}
type ChartParameter='level'|'levelBackup'|'levelDelta'|'temperature'|'rain'|'velocity';
const chartInfo:Record<ChartParameter,{label:string;unit:string;digits:number}>={
 level:{label:'радарното ниво',unit:'m',digits:3},
 levelBackup:{label:'контролното хидростатично ниво',unit:'m',digits:3},
 levelDelta:{label:'разликата между контролното и радарното ниво',unit:'m',digits:3},
 temperature:{label:'температурата на водата',unit:'°C',digits:1},
 rain:{label:'валежа за един час',unit:'mm',digits:2},
 velocity:{label:'повърхностната скорост',unit:'m/s',digits:2},
};

export function ReadingChart({readings,parameter='level',threshold,compact=false}:{readings:Reading[];parameter?:ChartParameter;threshold?:number;compact?:boolean}){
 const [hover,setHover]=useState<number|null>(null);
 const fillId=useId().replace(/:/g,'');
 const info=chartInfo[parameter];
 const valueOf=(reading:Reading|undefined):number|null=>{
  const value=reading?.[parameter];
  return typeof value==='number'&&Number.isFinite(value)?value:null;
 };
 const ordered=[...readings].sort((a,b)=>Date.parse(a.measuredAt)-Date.parse(b.measuredAt));
 const stride=Math.max(1,Math.ceil(ordered.length/120));
 // Пазим двата края на липсващите участъци и при разреждане на графиката.
 const data=ordered.filter((r,i,all)=>{
  const present=valueOf(r)!==null;
  return i%stride===0||i===all.length-1||(i>0&&present!==(valueOf(all[i-1])!==null))||(i<all.length-1&&present!==(valueOf(all[i+1])!==null));
 });
 const values=data.map(valueOf);
 const numericValues=values.filter((value):value is number=>value!==null);
 if(numericValues.length<2)return <div className="chart-empty">Недостатъчно измервания за графика</div>;
 const activeHover=hover!==null&&hover<data.length?hover:null;
 const hasThreshold=typeof threshold==='number'&&Number.isFinite(threshold);
 const minimum=Math.min(...numericValues,parameter==='levelDelta'?0:Infinity,hasThreshold?threshold:Infinity);
 const maximum=Math.max(...numericValues,parameter==='levelDelta'?0:-Infinity,hasThreshold?threshold:-Infinity);
 const padding=parameter==='levelDelta'?Math.max((maximum-minimum)*.12,.002):Math.max((maximum-minimum)*.12,.15);
 const lo=parameter==='rain'||parameter==='velocity'?Math.max(0,minimum-padding):minimum-padding;
 const hi=maximum+padding;
 const w=600,h=compact?150:230,left=52,right=588,bottom=h-30;
 const start=Date.parse(data[0].measuredAt),end=Date.parse(data[data.length-1].measuredAt);
 const x=(i:number)=>left+(end>start?(Date.parse(data[i].measuredAt)-start)/(end-start):i/(data.length-1))*(right-left);
 const y=(value:number)=>bottom-(value-lo)/(hi-lo)*(h-50);
 const segments:Array<Array<{x:number;y:number}>>=[];
 let segment:Array<{x:number;y:number}>=[];
 values.forEach((value,i)=>{
  if(value===null){if(segment.length)segments.push(segment);segment=[];return;}
  segment.push({x:x(i),y:y(value)});
 });
 if(segment.length)segments.push(segment);
 const pathOf=(points:Array<{x:number;y:number}>)=>points.map((point,i)=>`${i?'L':'M'}${point.x},${point.y}`).join(' ');
 return <div className={`reading-chart ${compact?'compact':''}`}>
  <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Графика на ${info.label}; мерна единица ${info.unit}; ${numericValues.length} измервания. Липсващите стойности прекъсват линията.`} onMouseMove={e=>{
   const bounds=e.currentTarget.getBoundingClientRect(),pointer=(e.clientX-bounds.left)/bounds.width*w;
   let nearest=0;
   for(let i=1;i<data.length;i++)if(Math.abs(x(i)-pointer)<Math.abs(x(nearest)-pointer))nearest=i;
   setHover(nearest);
  }} onMouseLeave={()=>setHover(null)}>
   <defs><linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#299c7e" stopOpacity=".2"/><stop offset="100%" stopColor="#299c7e" stopOpacity="0"/></linearGradient></defs>
   <text x={left} y="12" fill="#738578" fontSize="10">{info.unit}</text>
   {[0,1,2,3].map(i=>{const value=lo+(hi-lo)*i/3;return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#e6ede9" strokeDasharray="3 4"/><text x={left-8} y={y(value)+4} textAnchor="end" fill="#738578" fontSize="11">{num(value,parameter==='levelDelta'?3:parameter==='level'||parameter==='levelBackup'?2:1)}</text></g>})}
   {parameter==='levelDelta'&&<line x1={left} x2={right} y1={y(0)} y2={y(0)} stroke="#729d8c" strokeDasharray="5 4"/>}
   {hasThreshold&&<g><line x1={left} x2={right} y1={y(threshold)} y2={y(threshold)} stroke="#dcac50" strokeDasharray="6 5"/><text x={right-5} y={y(threshold)-6} textAnchor="end" fill="#aa7b2f" fontSize="10">учебен праг</text></g>}
   {segments.map((points,i)=><g key={i}>{points.length>1?<><path d={`${pathOf(points)} L${points[points.length-1].x},${parameter==='levelDelta'?y(0):bottom} L${points[0].x},${parameter==='levelDelta'?y(0):bottom} Z`} fill={`url(#${fillId})`}/><path d={pathOf(points)} fill="none" stroke="#23896e" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round"/></>:<circle cx={points[0].x} cy={points[0].y} r="2.5" fill="#23896e"/>}</g>)}
   {[0,.25,.5,.75,1].map((fraction,i)=>{const index=Math.round(fraction*(data.length-1));return <text key={i} x={x(index)} y={h-7} textAnchor="middle" fill="#738578" fontSize="11">{timeOnly(data[index].measuredAt)}</text>})}
   {activeHover!==null&&<g><line x1={x(activeHover)} x2={x(activeHover)} y1="18" y2={bottom} stroke="#729d8c" strokeDasharray="4 4"/>{values[activeHover]!==null&&<circle cx={x(activeHover)} cy={y(values[activeHover] as number)} r="4" stroke="white" strokeWidth="2" fill="#136e58"/>}</g>}
  </svg>
  {activeHover!==null&&<span className="chart-tooltip">{timeOnly(data[activeHover].measuredAt)} · {values[activeHover]===null?'Липсва валидна стойност':`${num(values[activeHover],info.digits)} ${info.unit}`}</span>}
 </div>;
}
