'use client';
import {useEffect,useRef,useState,useCallback} from 'react';
import type OlMap from 'ol/Map.js';
import type Overlay from 'ol/Overlay.js';
import {fromLonLat,transformExtent} from 'ol/proj.js';
import {Plus,Minus,LocateFixed,Maximize2,Layers,ArrowLeft} from 'lucide-react';
import 'ol/ol.css';
import type {Station} from '../../lib/types';
import {statusLabels} from '../../lib/seed';
import SchematicMap from './SchematicMap';

type Props={stations:Station[];selected?:string;onSelect:(id:string)=>void;focus?:{lat:number;lng:number;zoom:number;key:number};tall?:boolean};
const bulgaria=transformExtent([22.15,41.2,28.7,44.25],'EPSG:4326','EPSG:3857');

export default function RiverMap(props:Props){
 const host=useRef<HTMLDivElement>(null);
 const canvas=useRef<HTMLDivElement>(null);
 const mapRef=useRef<OlMap|null>(null);
 const overlayClass=useRef<typeof Overlay|null>(null);
 const markers=useRef<Overlay[]>([]);
 const current=useRef(props);current.current=props;
 const [reloadKey,setReloadKey]=useState(0);
 const [ready,setReady]=useState(false);
 const [failed,setFailed]=useState(false);
 const [schematic,setSchematic]=useState(false);
 const [zoom,setZoom]=useState(7);

 const renderMarkers=useCallback(()=>{
  const map=mapRef.current,OverlayClass=overlayClass.current;if(!map||!OverlayClass)return;
  markers.current.forEach(m=>map.removeOverlay(m));markers.current=[];
  const groups:{stations:Station[];lat:number;lng:number}[]=[];
  for(const s of current.current.stations){
   const p=map.getPixelFromCoordinate(fromLonLat([s.lng,s.lat]));if(!p)continue;
   const g=(map.getView().getZoom()||0)<10?groups.find(g=>{const q=map.getPixelFromCoordinate(fromLonLat([g.lng,g.lat]));return q&&Math.hypot(p[0]-q[0],p[1]-q[1])<28}):null;
   if(g){g.stations.push(s);g.lat=g.stations.reduce((a,s)=>a+s.lat,0)/g.stations.length;g.lng=g.stations.reduce((a,s)=>a+s.lng,0)/g.stations.length}else groups.push({stations:[s],lat:s.lat,lng:s.lng});
  }
  for(const g of groups){
   const s=g.stations[0],multi=g.stations.length>1;
   const status=g.stations.some(s=>s.current?.status==='critical')?'critical':g.stations.some(s=>s.current?.status==='warning')?'warning':s.current?.status||'normal';
   const element=document.createElement('button');element.type='button';
   element.className=`map-marker ${status} ${multi?'cluster':''} ${g.stations.some(s=>s.id===current.current.selected)?'selected':''}`;
   element.setAttribute('aria-label',multi?`${g.stations.length} станции около ${s.municipality}, увеличи`:`Отвори станция ${s.name}`);
   element.title=multi?`${g.stations.length} станции · увеличаване`:`${s.name} · ${statusLabels[status]} · ${s.current?.level.toFixed(2)||'—'} m`;
   if(multi)element.textContent=String(g.stations.length);else element.appendChild(document.createElement('span'));
   element.onclick=e=>{e.stopPropagation();if(multi)map.getView().animate({center:fromLonLat([g.lng,g.lat]),zoom:(map.getView().getZoom()||7)+2,duration:350});else current.current.onSelect(s.id)};
   const marker=new OverlayClass({element,position:fromLonLat([g.lng,g.lat]),positioning:'center-center',stopEvent:true});
   map.addOverlay(marker);markers.current.push(marker);
  }
 },[]);

 useEffect(()=>{
  if(schematic||failed||!canvas.current)return;
  let disposed=false;let resize:ResizeObserver|undefined;let map:OlMap|undefined;
  setReady(false);
  (async()=>{
   try{
    const [{default:Map},{default:View},{default:Overlay},{default:LayerGroup},{apply},{defaults}]=await Promise.all([import('ol/Map.js'),import('ol/View.js'),import('ol/Overlay.js'),import('ol/layer/Group.js'),import('ol-mapbox-style'),import('ol/interaction/defaults.js')]);
    if(disposed||!canvas.current)return;
    overlayClass.current=Overlay;
    const base=new LayerGroup();
    map=new Map({target:canvas.current,layers:[base],controls:[],interactions:defaults({altShiftDragRotate:false,pinchRotate:false}),view:new View({center:fromLonLat([25.3,42.75]),zoom:7,minZoom:5,maxZoom:19,extent:transformExtent([18,38,33,48],'EPSG:4326','EPSG:3857')})});
    mapRef.current=map;
    map.getView().fit(bulgaria,{padding:[44,24,44,24],duration:0});
    if(current.current.focus){const f=current.current.focus;map.getView().setCenter(fromLonLat([f.lng,f.lat]));map.getView().setZoom(f.zoom)}
    map.on('moveend',()=>{if(!disposed){setZoom(map!.getView().getZoom()||7);renderMarkers()}});
    resize=new ResizeObserver(()=>map?.updateSize());resize.observe(canvas.current);
    map.once('postrender',renderMarkers);
    const styleResponse=await fetch('https://tiles.openfreemap.org/styles/liberty');
    if(!styleResponse.ok)throw new Error('Неуспешно зареждане на картографския стил.');
    const style=await styleResponse.json() as {layers?:Array<{type:string;layout?:Record<string,unknown>}>};
    for(const layer of style.layers||[]){
     if(layer.type==='symbol'&&JSON.stringify(layer.layout?.['text-field']||'').includes('name'))layer.layout!['text-field']=['coalesce',['get','name:bg'],['get','name'],['get','name:nonlatin'],['get','name:latin']];
    }
    await apply(base,style);
    if(!disposed){setReady(true);renderMarkers()}
   }catch(error){console.warn('Картографска основа:',error);if(!disposed)setFailed(true)}
  })();
  return()=>{disposed=true;resize?.disconnect();markers.current.forEach(m=>map?.removeOverlay(m));markers.current=[];map?.setTarget(undefined);map?.dispose();mapRef.current=null;};
 },[schematic,failed,reloadKey,renderMarkers]);
 useEffect(()=>{renderMarkers()},[props.stations,props.selected,renderMarkers]);
 useEffect(()=>{if(props.focus&&mapRef.current)mapRef.current.getView().animate({center:fromLonLat([props.focus.lng,props.focus.lat]),zoom:props.focus.zoom,duration:450})},[props.focus]);
 const changeZoom=(delta:number)=>{const view=mapRef.current?.getView();if(view)view.animate({zoom:(view.getZoom()||7)+delta,duration:200})};
 if(schematic||failed)return <div className="fallback-map-wrap"><SchematicMap {...props}/><button className="button secondary map-return" onClick={()=>{setSchematic(false);setFailed(false);setReloadKey(k=>k+1)}}><ArrowLeft size={13}/>{failed?'Картографската основа е недостъпна · опитай отново':'Към подробната карта'}</button></div>;
 return <div className={`river-map vector-map ${props.tall?'tall':''}`} ref={host}>
  <div className="vector-map-canvas" ref={canvas} tabIndex={0} role="region" aria-label="Интерактивна карта на речните станции. Стрелки за преместване, плюс и минус за мащаб."/>
  {!ready&&<div className="map-loading">Зареждане на картографската основа…</div>}
  <div className="map-top map-overlay"><span className="map-scope"><span className="live-dot"/>{props.stations.length} демонстрационни пункта</span></div>
  <div className="map-controls map-overlay"><button aria-label="Увеличи картата" onClick={()=>changeZoom(1)}><Plus size={18}/></button><button aria-label="Намали картата" onClick={()=>changeZoom(-1)}><Minus size={18}/></button><span/><button aria-label="Покажи цяла България" onClick={()=>mapRef.current?.getView().fit(bulgaria,{padding:[44,24,44,24],duration:450})}><LocateFixed size={18}/></button><button aria-label="Смени картографската основа" title="Схематична карта" onClick={()=>setSchematic(true)}><Layers size={18}/></button><button aria-label="Карта на цял екран" onClick={()=>{if(document.fullscreenElement)document.exitFullscreen();else host.current?.requestFullscreen().catch(()=>{})}}><Maximize2 size={17}/></button></div>
  <div className="map-legend map-overlay"><span><i className="dot normal"/>В норма</span><span><i className="dot warning"/>Внимание</span><span><i className="dot critical"/>Критично</span><span><i className="dot offline"/>Без връзка</span></div>
  <span className="map-scale-text">Мащаб {zoom.toFixed(1)}</span>
  <div className="map-attribution"><a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a></div>
 </div>;
}
