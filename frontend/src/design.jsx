import React from 'react';
import GoogleSignInButton from './GoogleSignInButton.jsx';
import {FATIGUE_SCALE as scale} from './copy.js';
export const Icon=({name})=><img className="icon" src={`/assets/icons/${name}.svg`} alt=""/>;
export const Art=({name,className=''})=><img className={`art ${className}`} src={`/assets/illustrations/${name}.svg`} alt=""/>;
export const Button=({children,kind='primary',...props})=><button className={`button ${kind}`} {...props}>{children}</button>;
export function Actions({children}){return <div className="actions">{children}</div>}
export function AppBar({title='',back}){return <header>{back?<button aria-label="뒤로 가기" onClick={back}><Icon name="back"/></button>:<span/>}<strong>{title}</strong><span/></header>}
export function Welcome({login,busy}) {
 return <section className="welcome" data-design-node="17:87">
  <div className="welcome-hero">
   <img src="/assets/brand/modo-wordmark.svg" width="206" height="51" alt="MODO"/>
   <p className="welcome-tagline">
    빠른길도<br/>
    편한길도<br/>
    <strong>모도</strong>
   </p>
  </div>
  <Actions><GoogleSignInButton onClick={login} disabled={busy}/></Actions>
 </section>
}
export function CalendarIntro({state='connect',busy,connect,error}){const copy={connect:['다음 약속을 불러올까요?',<>일정의 시간과 장소를 읽어서<br/>늦지 않는 길을 찾아요.</>,'캘린더 연결하기','나중에 연결하기','calendar'],failed:['캘린더를 연결하지 못했어요.','잠시 후 다시 시도해 주세요.','다시 시도','나중에','calendar-failed'],expired:['캘린더 연결이 끊어졌어요.','다시 연결해 주세요.','다시 연결','나중에','calendar-expired']}[state];return <section className={`calendar-intro ${state}`} data-design-node="17:105"><div className="calendar-hero"><Art name={copy[4]}/><h1>{copy[0]}</h1><p>{copy[1]}</p>{error&&<p role="alert">{error}</p>}</div><Actions><Button disabled={busy} onClick={connect}>{busy?'연결 확인 중…':copy[2]}</Button></Actions></section>}
export function PlaceRow({place,onClick,tail}){return <button className="place-row" onClick={onClick}><span className="place-icon"><Icon name="pin"/></span><span className="place-copy"><strong>{place.alias||place.name||place.address}</strong><small>{place.subtitle||place.address}</small></span>{tail&&<small>{tail}</small>}</button>}
export function Field({label,value,onClick,error}){return <button className={`field ${error?'invalid':''}`} onClick={onClick} disabled={!onClick}><span><small>{label}</small><strong>{value}</strong></span>{onClick&&<Icon name="chevronRight"/>}</button>}
export function FatigueScale({value,onChange}){return <div className={`fatigue ${value===null?'unset':''}`} style={{'--progress':`${((value??1)-1)*25}%`}}><div className="slider"><div className="scale-track"/><div className="scale-ticks">{[1,2,3,4,5].map(n=><i key={n} className={value!==null&&n<=value?'filled':''}/>)}</div><input aria-label={scale.title} type="range" min="1" max="5" step="1" value={value??1} aria-valuetext={value===null?'선택하지 않음':`${value}단계`} onChange={e=>onChange(Number(e.target.value))} onPointerDown={()=>value===null&&onChange(1)}/></div><div className="numbers">{[1,2,3,4,5].map(n=><button key={n} aria-label={`피로도 ${n} 선택`} aria-pressed={value===n} onClick={()=>onChange(n)}>{n}</button>)}</div><div className="scale-labels"><span>{scale.minLabel}</span><span>{scale.maxLabel}</span></div></div>}
export function Sheet({children,className=''}){return <section className={`sheet ${className}`}><div className="handle"/>{children}</section>}
export const Badge=()=> <span className="badge">데모 예시</span>;
export function Summary({values}){return <div className="summary-card">{values.map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>}
export function ListRow({title,subtitle,tail,onClick}){return <button className="list-row" onClick={onClick}><Icon name="calendar"/><span><strong>{title}</strong>{subtitle&&<small>{subtitle}</small>}</span>{tail??<Icon name="chevronRight"/>}</button>}
export function MapSurface({routes=false,demo=false,state}){
 const routed=routes&&demo&&!['loading','route-error'].includes(state);
 const waypoint=['waypoint','waypoint-confirmed'].includes(state);
 const asset=(name,x,y,id=waypoint?'22-653':'21-627')=><img key={name+x+y} className="map-asset" style={{left:x,top:y}} src={`/assets/figma/${id}-${name}.svg`} alt=""/>;
 const origin=routed?[92,267]:[87,259],destination=routed?[252,57]:[246,85];
 return <div className="map-placeholder" aria-label="지도 SDK 영역">
 {!routes&&<span className="current-marker"/>}
 {routed&&<div className="route-artwork">
 {state==='routes'&&asset('imgRouteAlt',109,99,'21-627')}
 {asset('imgRouteWalkStart',109,239)}{asset('imgRouteLine2',107,167)}
 {waypoint?<>{asset('imgRouteLine5Leg1',187,167)}{asset('imgRouteLine5Leg2',228.5,128.5)}</>:asset('imgRouteLine5',187,127,'21-627')}
 {asset('imgRouteWalkEnd',269,99)}
 {[ [100,231],[180,161],[260,121] ].map(([x,y])=>asset('imgStation',x,y))}
 <span className="line-badge line-two">2</span><span className={`line-badge line-five ${waypoint?'detour':''}`}>5</span>
 {['stops','waypoint','waypoint-confirmed'].includes(state)&&asset('imgTypeWaypointCandidate',waypoint?209:179,waypoint?127:207,'22-653')}
 </div>}
 {routes&&<>{asset('imgTail',origin[0]+11,origin[1]+31,'21-627')}{asset('imgTail1',destination[0]+11,destination[1]+31,'21-627')}<span className="origin-marker" style={{left:origin[0],top:origin[1]}}>출발</span><span className="destination-marker" style={{left:destination[0],top:destination[1]}}>도착</span></>}
 </div>
}
