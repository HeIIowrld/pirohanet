import { prepareTrip } from '../../src/main/trip.js';
import { compareRoutes } from '../../src/routing/compare.js';
import { summarize } from '../../src/calendar/calendar.js';
import { api } from '../../src/preferences/account-api.js';
export { api };
export const clock = value => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export const localInput = date => new Date(+new Date(date) + 9*3600000).toISOString().slice(0,16);
export const fromInput = value => value ? new Date(value + ':00+09:00') : null;
export function suggestedLevel(events, now) { const f=summarize(events, now).suggestedFatigue; return f ? f.level*2+1 : null; }
export function makeTrip(form, event, level, now=new Date()) {
  if(level!==null && ![1,2,3,4,5].includes(level)) throw new Error('피로도는 1에서 5 사이여야 해요.');
  const departAt=fromInput(form.departure) ?? now, arriveBy=fromInput(form.arrival);
  const timeError=validateTimes({...form,departure:form.departure||localInput(now)},event);
  if(timeError)throw new Error(timeError);
  if(!form.origin?.trim() || !form.destination?.trim()) throw new Error('출발지와 목적지를 입력해 주세요.');
  if(arriveBy && arriveBy<=departAt) throw new Error('도착 목표는 출발 시각 이후로 정해 주세요.');
  if(event && arriveBy && +arriveBy>Date.parse(event.start.dateTime)) throw new Error('약속 시각 이전으로 도착 목표를 정해 주세요.');
  // Keep the calendar module's existing 0–2 API compatible. UI values remain 1–5.
  const trip=prepareTrip({origin:form.origin,destination:form.destination,departAt}, [], now);
  return {...trip,arriveBy,preferences:{...trip.preferences,...form.preferences,fatigueLevel:level,normalizedFatigue:level===null?null:(level-1)/4,maxExtraTravelMinutes:form.preferences?.maxExtraTravelMinutes??null}};
}
export function routeResult(data, trip, stayMinutes=20) {
  const unique=[data.baseline,...(data.direct??[]),data.recommended,...(data.stops??[])].filter((r,i,a)=>r && a.findIndex(x=>x?.id===r.id)===i);
  const all=unique.map(r=>({...r,travelMinutes:r.walk,stayMinutes:r.place?stayMinutes:0,viaStop:Boolean(r.place),arrivalAt:new Date(+trip.departAt+(r.walk+(r.place?stayMinutes:0))*60000)}));
  const eligible=compareRoutes(all,{departAt:trip.departAt,arriveBy:trip.arriveBy,maxExtraTravelMinutes:trip.preferences.maxExtraTravelMinutes});
  return {all,eligible,direct:eligible.filter(r=>!r.viaStop),stops:eligible.filter(r=>r.viaStop)};
}
export async function queryRoutes(trip,{demo=false,stops=false,saved=[],locations={}}={}) {
  // The existing walking provider requires an upper bound. With no user target,
  // use a provider-only horizon and remove that constraint in routeResult.
  return api('/api/recommend','POST',{mode:demo?'demo':'live',origin:trip.origin,destination:trip.destination,
    departAt:trip.departAt.toISOString(),arriveBy:(trip.arriveBy??new Date(+trip.departAt+86400000)).toISOString(),
    fatigue:trip.preferences.fatigueLevel>=4?'tired':trip.preferences.fatigueLevel<=2&&trip.preferences.fatigueLevel!==null?'relaxed':'normal',
    allowance:30,includeStops:stops,places:stops?saved.map(p=>({name:p.name||p.alias,category:'기타'})):[],calendar:!demo,locations});
}
export function mapLink(origin,destination) {
  return `https://map.kakao.com/link/from/${encodeURIComponent(origin.name||origin.address)},${origin.latitude},${origin.longitude}/to/${encodeURIComponent(destination.name||destination.address)},${destination.latitude},${destination.longitude}`;
}
// Keep the existing geocoder contract intact while allowing Kakao-only installs.
export async function searchWithFallback(query, lookup, fetchFn=fetch) {
  try { return await lookup(query); }
  catch (error) {
    const response=await fetchFn(`/api/place?${new URLSearchParams({query})}`);
    if(!response.ok) throw error;
    return ((await response.json()).documents??[]).slice(0,5).map(p=>({name:p.place_name,address:p.road_address_name||p.address_name,latitude:Number(p.y),longitude:Number(p.x)}));
  }
}
export function validateTimes(form,event) {
 const departure=fromInput(form.departure),arrival=fromInput(form.arrival);
 if(!departure||!Number.isFinite(+departure)) return '출발 시각을 확인해 주세요.';
 if(form.arrival&&!Number.isFinite(+arrival)) return '도착 목표를 확인해 주세요.';
 if(arrival&&arrival<=departure) return '도착 목표는 출발 시각 이후로 정해 주세요.';
 if(arrival&&event&&+arrival>Date.parse(event.start.dateTime)) return '약속 시각 이전으로 도착 목표를 정해 주세요.';
 return null;
}
export function timeDraftFromInput(value,now=new Date()) {
 const date=fromInput(value)??now;
 const local=localInput(date),hour=Number(local.slice(11,13));
 return {ampm:hour>=12?'오후':'오전',hour:String(hour%12||12),minute:String(Math.floor(Number(local.slice(14,16))/5)*5).padStart(2,'0')};
}
export function applyTimeDraft(form,kind,draft,event) {
 const hour=Number(draft.hour)%12+(draft.ampm==='오후'?12:0);
 const day=(form[kind]||form.departure).slice(0,10);
 let value=`${day}T${String(hour).padStart(2,'0')}:${draft.minute}`;
 if(kind==='arrival'&&fromInput(value)<=fromInput(form.departure)) value=localInput(new Date(+fromInput(value)+86400000));
 const updated={...form,[kind]:value};
 const error=validateTimes(updated,event);
 if(error)throw new Error(error);
 return value;
}
export function backScreen(screen,picker,searchReturn='home') {
 if(screen==='search')return picker==='save'?'saved':searchReturn;
 return {calendar:'welcome',settings:'my',saved:'my',my:'home',confirm:'home',condition:'confirm',routes:'condition',details:'routes',stops:'routes',waypoint:'stops','waypoint-confirmed':'waypoint','route-error':'confirm'}[screen]??'home';
}
export function preferredDirect(routes,preferences={}) {
 if(!routes.length)return null;
 const key={walking:'walkMinutes',transfers:'transfers',crowding:'crowdingScore'}[preferences.priority];
 const measure=route=>key==='walkMinutes'?(route.walkMinutes??route.travelMinutes):route[key];
 const known=key?routes.filter(route=>Number.isFinite(measure(route))):routes;
 const ranked=[...(known.length?known:routes)].sort((a,b)=>{
  if(preferences.avoidStairs&&Number.isFinite(a.stairs)&&Number.isFinite(b.stairs)&&a.stairs!==b.stairs)return a.stairs-b.stairs;
  if(key&&Number.isFinite(measure(a))&&Number.isFinite(measure(b))&&measure(a)!==measure(b))return measure(a)-measure(b);
  return a.travelMinutes-b.travelMinutes;
 });
 return ranked[0];
}
