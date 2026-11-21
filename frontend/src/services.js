import { prepareTrip } from '../../src/main/trip.js';
import { addBusObservations } from '../../src/routing/bus-observations.js';
import { queryTransit } from '../../src/routing/transit.js';
import { gapPlaces } from './gap-places.js';
import { compareRoutes, comfortReasons, isDirect } from '../../src/routing/compare.js';
import { summarize } from '../../src/calendar/calendar.js';
import { api } from '../../src/preferences/account-api.js';
export { api };
export const clock = value => new Intl.DateTimeFormat('ko-KR', {timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
export const localInput = date => new Date(+new Date(date) + 9*3600000).toISOString().slice(0,16);
export const fromInput = value => value ? new Date(value + ':00+09:00') : null;
// 달력 모듈의 피로도는 이미 1~5점이다. 환산하지 않고 그대로 쓴다.
export function suggestedLevel(events, now) { return summarize(events, now).suggestedFatigue?.level ?? null; }
// 경로 추천에 쓰는 최종 피로도: 고른 컨디션에 약속 전까지 남은 일정 부담을 더한 값(최대 5).
// 건너뛰면(null) 달력만으로 계산하고, 달력 근거도 없으면 null이다.
export function finalLevel(events, level, now=new Date()) { return summarize(events, now, level).fatigue?.level ?? level; }
export function makeTrip(form, event, level, now=new Date()) {
  if(level!==null && ![1,2,3,4,5].includes(level)) throw new Error('피로도는 1에서 5 사이여야 해요.');
  const departAt=fromInput(form.departure) ?? now, arriveBy=fromInput(form.arrival);
  const timeError=validateTimes({...form,departure:form.departure||localInput(now)},event);
  if(timeError)throw new Error(timeError);
  if(!form.origin?.trim() || !form.destination?.trim()) throw new Error('출발지와 목적지를 입력해 주세요.');
  if(arriveBy && arriveBy<=departAt) throw new Error('도착 목표는 출발 시각 이후로 정해 주세요.');
  if(event && arriveBy && +arriveBy>Date.parse(event.start.dateTime)) throw new Error('약속 시각 이전으로 도착 목표를 정해 주세요.');
  const trip=prepareTrip({origin:form.origin,destination:form.destination,departAt}, event ? [event] : [], now);
  return {...trip,arriveBy,preferences:{...trip.preferences,...form.preferences,fatigueLevel:level,normalizedFatigue:level===null?null:(level-1)/4,maxExtraTravelMinutes:form.preferences?.maxExtraTravelMinutes??null}};
}
function routeKey(route) {
  return JSON.stringify(route.steps.map(step => [step.guidance, step.type, step.time]));
}

export function routeCategory(route) {
  if (route.mode === 'BUS_AND_SUBWAY') return '지하철+버스';
  if (route.mode === 'BUS') return route.transfers > 0 ? '버스 환승' : '버스 직행';
  if (route.mode === 'SUBWAY') return '지하철';
  return null;
}

export function hasLateNightBusLeg(route) {
  return (route.steps ?? []).some(step => step.type === 'BUS' && step.vehicles?.length &&
    step.vehicles.every(vehicle => vehicle.name?.includes('(심야)')));
}

function alternateRoutes(direct, recommended) {
  const shown = new Set(recommended.map(routeCategory));
  const alternatives = [];
  const byPracticality = (a,b) => Number(hasLateNightBusLeg(a)) - Number(hasLateNightBusLeg(b)) ||
    a.arrivalAt - b.arrivalAt;
  for (const route of [...direct].sort(byPracticality)) {
    const category = routeCategory(route);
    if (!category || shown.has(category)) continue;
    shown.add(category);
    alternatives.push(route);
  }
  return alternatives;
}

export function routeResult(candidates, trip, places) {
  const options = {departAt:trip.departAt, preferences:trip.preferences, places};
  const all = compareRoutes(candidates, options);
  const eligible = compareRoutes(candidates, {...options, arriveBy:trip.arriveBy,
    maxExtraTravelMinutes:trip.preferences.maxExtraTravelMinutes});
  const direct = eligible.filter(isDirect);
  const fastest = direct.reduce((best, item) => !best || item.arrivalAt < best.arrivalAt ? item : best, null);
  const easier = fastest && direct
    .filter(item => item.id !== fastest.id && item.comfortScore < fastest.comfortScore - 0.01)
    .map(item => ({item,reasons:comfortReasons(item,fastest,trip.preferences)}))
    .find(choice => choice.reasons.length > 0);
  const tradeoff = fastest && !easier && direct.find(item => item.id !== fastest.id &&
    (item.walkMinutes < fastest.walkMinutes || item.transfers < fastest.transfers));
  const second = easier?.item ?? tradeoff;
  const recommended = [fastest,second].filter(Boolean);
  const secondLabel = easier ? '편한 길' : tradeoff?.transfers < fastest?.transfers ? '환승 적은 길' : '도보 적은 길';
  return {
    all, eligible,
    direct:recommended,secondLabel,comfortReasons:easier?.reasons,
    alternatives:alternateRoutes(direct,recommended),
    stops:eligible.filter(item => item.viaStop),
  };
}

export async function queryRoutes(trip, {places, previous, stops=false, saved=[], stayMinutes=20}={}) {
  if (!places?.origin || !places?.destination) throw new Error('출발지와 목적지를 다시 선택해 주세요.');
  if (!stops) {
    const all = await queryTransit({...trip, places});
    const candidates = all.map(item => ({...item,id:routeKey(item),stayMinutes:0}));
    const initial = routeResult(candidates,trip,places);
    const fastest = initial.direct[0];
    const ordered = initial.eligible.filter(route => isDirect(route) && route.id !== fastest?.id);
    const candidatesWithData = [fastest,...ordered].filter(Boolean);
    const withData = await addBusObservations(candidatesWithData);
    const byId = new Map(withData.map(item => [item.id,item]));
    return routeResult(candidates.map(item => byId.get(item.id) ?? item),trip,places);
  }
  const baseline = previous?.direct[0];
  const freeMinutes = baseline && trip.arriveBy
    ? Math.max(0, Math.floor((trip.arriveBy - trip.departAt) / 60_000 - baseline.travelMinutes))
    : null;
  if (freeMinutes !== null && freeMinutes < 5) return {...previous, stops:[], freeMinutes};
  const stopPlaces = await gapPlaces(places, baseline, saved);
  const results = await Promise.allSettled(stopPlaces.map(async place => {
    const preferences = {...trip.preferences, savedStop:{query:place.name || place.alias, stayMinutes}};
    const candidates = await queryTransit({...trip, places:{...places, stop:place}, preferences, detourOnly:true, stopArriveBy:trip.arriveBy});
    return candidates.filter(item => item.viaStop).map(item => ({...item, place,
      id:JSON.stringify([place.latitude, place.longitude, routeKey(item)])}));
  }));
  const candidates = results.flatMap(item => item.status === 'fulfilled' ? item.value : []);
  const compared = routeResult([...(previous?.all ?? []).filter(isDirect), ...candidates], trip, places);
  return {...compared, freeMinutes,
    stopLookupFailed:results.some(item => item.status === 'rejected'),
    stops:compared.stops.sort((a,b) => b.stayMinutes-a.stayMinutes || a.travelMinutes-b.travelMinutes),
    direct:previous?.direct ?? compared.direct,
    secondLabel:previous?.secondLabel ?? compared.secondLabel,
    alternatives:previous?.alternatives ?? compared.alternatives,
  };
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
