'use client';
import {X,LoaderCircle,ArrowUpRight,ChevronDown} from 'lucide-react';
import type {ReactNode} from 'react';
import {useEffect,useRef} from 'react';
import {statusLabels} from '../../lib/seed';
export function Badge({status,children}:{status?:string;children?:ReactNode}){return <span className={`badge ${status||''}`}><i/>{children||statusLabels[status as keyof typeof statusLabels]||status}</span>}
export function Empty({title,description}:{title:string;description?:string}){return <div className="empty-state"><div className="empty-symbol">≈</div><h3>{title}</h3>{description&&<p>{description}</p>}</div>}
export function Loading(){return <div className="loading-state"><LoaderCircle className="spin" size={25}/><span>Зареждане на измерванията…</span></div>}
export function SectionHead({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <div className="section-head"><div>{eyebrow&&<div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1>{description&&<p>{description}</p>}</div>{actions&&<div className="head-actions">{actions}</div>}</div>}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{ref.current?.showModal();return()=>ref.current?.close()},[]);return <dialog ref={ref} className={`modal ${wide?'wide':''}`} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose()}}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Затвори" onClick={onClose}><X size={20}/></button></div><div className="modal-body">{children}</div></dialog>}
export function Field({label,children,hint}:{label:string;children:ReactNode;hint?:string}){return <label className="field"><span>{label}</span>{children}{hint&&<small>{hint}</small>}</label>}
export function Fact({label,value,unit}:{label:string;value:ReactNode;unit?:string}){return <div className="fact"><span>{label}</span><strong>{value}{unit&&<small> {unit}</small>}</strong></div>}
export function External({href,children}:{href:string;children:ReactNode}){return <a className="source-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13}/></a>}
export const dateTime=(s:string|undefined)=>s?new Date(s).toLocaleString('bg-BG',{timeZone:'Europe/Sofia',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
export const timeOnly=(s:string|undefined)=>s?new Date(s).toLocaleTimeString('bg-BG',{timeZone:'Europe/Sofia',hour:'2-digit',minute:'2-digit'}):'—';
export const num=(n:number|null|undefined,d=2)=>typeof n==='number'?n.toLocaleString('bg-BG',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
export function Details({title,children,open=false}:{title:string;children:ReactNode;open?:boolean}){return <details className="disclosure" open={open||undefined}><summary>{title}<ChevronDown size={17}/></summary><div>{children}</div></details>}
export function downloadBlob(blob:Blob,filename:string){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
