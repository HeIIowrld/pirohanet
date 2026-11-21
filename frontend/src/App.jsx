import TimeWheel from './TimeWheel.jsx';
import Onboarding from './Onboarding.jsx';
import {readOnboarding,completeOnboarding,DEFAULT_TRAVEL_PREFERENCES,normalizeTravelPreferences} from './onboarding.js';
import React,{useEffect,useRef,useState} from 'react';
import {locateCandidates,exportSavedPlaces,savePlace as saveLocal,syncMyPlaces,pushMyPlaces} from '../../src/calendar/location.js';
import {fetchGoogleEvents,requestGoogleAuthorization} from '../../src/calendar/calendar.js';
import {planDepartureReminder} from '../../src/main/departure-reminder.js';
import {readSession,saveSession,clearSession} from '../../src/main/login-session.js';
import {RouteDetails,RouteComparison} from './RouteFlow.jsx';
import LiveMap from './LiveMap.jsx';
import {FATIGUE_SCALE as scale} from './copy.js';
import {designRoutes} from './design-demo.js';
import {api,clock,localInput,fromInput,suggestedLevel,makeTrip,queryRoutes,searchWithFallback,validateTimes,timeDraftFromInput,applyTimeDraft,backScreen} from './services.js';
import {Icon,Art,Button,Actions,AppBar,Welcome,CalendarIntro,PlaceRow,Field,FatigueScale,Sheet,Badge,Summary,ListRow,MapSurface} from './design.jsx';
const kstNow=()=>localInput(new Date());
const designDemo=import.meta.env.DEV && new URLSearchParams(location.search).get('demo')==='1';
const emptyForm=()=>({origin:'',destination:'',departure:kstNow(),arrival:''});
export default function App(){
 const [screen,setScreen]=useState('welcome'),[events,setEvents]=useState([]),[linked,setLinked]=useState(false),[saved,setSaved]=useState([]),[event,setEvent]=useState(null),[form,setForm]=useState(emptyForm),[level,setLevel]=useState(null),[demo,setDemo]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[query,setQuery]=useState(''),[hits,setHits]=useState(null),[picker,setPicker]=useState('destination'),[points,setPoints]=useState({}),[trip,setTrip]=useState(null),[result,setResult]=useState(null),[route,setRoute]=useState(null),[stay,setStay]=useState(designDemo?10:20),[dwell,setDwell]=useState(false);
 const [calendarState,setCalendarState]=useState('connect'),[expanded,setExpanded]=useState(false),[stopIndex,setStopIndex]=useState(0),[timePicker,setTimePicker]=useState(null),[timeDraft,setTimeDraft]=useState({ampm:'오후',hour:'6',minute:'00'});
 const [searchReturn,setSearchReturn]=useState('home'),[locatedOnly,setLocatedOnly]=useState(true);
 const [onboarding,setOnboarding]=useState(()=>readOnboarding(designDemo));
 const request=useRef(0);
 const retry=useRef(null);
 const [expiresAt,setExpiresAt]=useState(null);
 const [conditionChanged,setConditionChanged]=useState(false);
 const [avoidLine,setAvoidLine]=useState('');
 const [directChoice,setDirectChoice]=useState(null);
 const [departureAlert,setDepartureAlert]=useState(null);
 const alerted=useRef(new Set());
 const returnTo=backScreen(screen,picker,searchReturn);
 const timeError=validateTimes(form,event);
 const go=s=>{request.current++;setScreen(!linked&&!['welcome','calendar'].includes(s)?'calendar':s);setError('');setBusy(false)};
 const enterHome=()=>{request.current++;setScreen(onboarding.completed?'home':'onboarding');setError('');setBusy(false)};
 function finishOnboarding(answers){const preferences=normalizeTravelPreferences(answers??DEFAULT_TRAVEL_PREFERENCES);const stored=completeOnboarding(preferences,designDemo);setOnboarding({completed:true,preferences});go('home');if(!stored)setToast('이 브라우저에서는 선호를 저장하지 못했어요.');}

 function disconnect() {
  request.current++;
  clearSession();
  setLinked(false);
  setEvents([]);
  setSaved([]);
  setEvent(null);
  setPoints({});
  setForm(emptyForm());
  setLevel(null);
  setAvoidLine('');
  setTrip(null);
  setResult(null);
  setRoute(null);
  setDirectChoice(null);
  setExpanded(false);
  setDwell(false);
  setTimePicker(null);
  setExpiresAt(null);
  setDepartureAlert(null);
  alerted.current.clear();
  setError('');
  setBusy(false);
  setScreen('welcome');
 }
 async function connectCalendar(session, id) {
  setCalendarState('connect');
  setScreen('calendar');
  setBusy(true);
  setError('');
  try {
   const items=await fetchGoogleEvents(session.token);
   if(request.current!==id)return;
   setEvents(items);
   setSaved(savedPlaces());
   setLinked(true);
   setExpiresAt(session.expiresAt);
   enterHome();
   void syncMyPlaces(session.token).then(()=>{
    if(readSession()?.token===session.token)setSaved(savedPlaces());
   }).catch(()=>{
    if(readSession()?.token===session.token)setToast('이 브라우저에 저장된 장소를 사용해요.');
   });
  } catch(error) {
   if(request.current!==id)return;
   const expired=error.message==='Calendar API 401';
   if(expired)clearSession();
   setLinked(false);
   setCalendarState(expired?'expired':'failed');
   setError(expired?'Google로 다시 로그인해 주세요.':'캘린더 읽기 권한을 확인하고 다시 시도해 주세요.');
   setBusy(false);
  }
 }
 const savedPlaces=()=>Object.entries(exportSavedPlaces()).map(([alias,place])=>({...place,alias}));
 useEffect(()=>{
  if(designDemo)return;
  const session=readSession();
  if(session)void connectCalendar(session,++request.current);
  return()=>{request.current++};
 },[]);
 useEffect(()=>{
  if(!expiresAt)return;
  const timer=setTimeout(disconnect,Math.max(0,expiresAt-Date.now()));
  return()=>clearTimeout(timer);
 },[expiresAt]);
 useEffect(()=>{if(!toast)return;const id=setTimeout(()=>setToast(''),4500);return()=>clearTimeout(id)},[toast]);
 useEffect(()=>{
  if(!trip||!route||!linked||designDemo)return;
  const reminder=planDepartureReminder(trip,{route});
  if(!reminder)return;
  const check=()=>{
   const now=Date.now();
   if(now<reminder.leaveAt||now>=reminder.startsAt||alerted.current.has(reminder.key))return;
   alerted.current.add(reminder.key);
   setDepartureAlert(reminder);
  };
  const timer=setTimeout(check,Math.max(0,reminder.leaveAt-Date.now()));
  document.addEventListener('visibilitychange',check);
  return()=>{clearTimeout(timer);document.removeEventListener('visibilitychange',check)};
 },[trip,route,linked]);
 function openTime(kind){setTimeDraft(timeDraftFromInput(form[kind]||form.departure));setTimePicker(kind)}
 function commitTime(){try{update(timePicker,applyTimeDraft(form,timePicker,timeDraft,event));setTimePicker(null);setError('')}catch(e){setToast(e.message)}}
 const update=(key,value)=>setForm(f=>({...f,[key]:value}));
 const upcoming=events.filter(e=>e.status!=='cancelled'&&e.transparency!=='transparent'&&!e.attendees?.some(a=>a.self&&a.responseStatus==='declined')&&e.start?.dateTime&&(designDemo||Date.parse(e.start.dateTime)>Date.now())&&(!locatedOnly||e.location)).sort((a,b)=>Date.parse(a.start.dateTime)-Date.parse(b.start.dateTime));
 async function calendar(){
  if(designDemo){
   const now=fromInput(kstNow().slice(0,10)+'T18:00');
   setDemo(true);
   setEvents([{id:'design-event',summary:'광화문 미팅',location:'광화문',start:{dateTime:new Date(+now+3600000).toISOString()},end:{dateTime:new Date(+now+7200000).toISOString()}}]);
   setLinked(true);
   setForm({origin:'현재 위치, 성수동',destination:'광화문',departure:localInput(now),arrival:localInput(new Date(+now+3300000))});
   setSaved([{name:'열린책방',subtitle:'서점, 종로구',distance:'1.1km'},{name:'커피 한 잔',subtitle:'카페, 성수동',distance:'0.4km'},{name:'우리동네 갤러리',subtitle:'전시, 서촌',distance:'2.0km'}]);
   enterHome();
   return;
  }
  if(busy)return;
  if(!window.google?.accounts?.oauth2){
   setError('Google 로그인을 불러오는 중이에요. 잠시 후 다시 시도해 주세요.');
   return;
  }
  const id=++request.current;
  setBusy(true);
  setError('');
  try {
   const authorization=await requestGoogleAuthorization();
   if(request.current!==id)return;
   saveSession(authorization);
   await connectCalendar(readSession(),id);
  } catch(error) {
   if(request.current!==id)return;
   setError(error.message==='popup_closed'?'Google 로그인 창을 닫았어요. 다시 시도해 주세요.':'Google 로그인을 완료하지 못했어요. 다시 시도해 주세요.');
   setBusy(false);
  }
 }
 function openSearch(field='destination'){setSearchReturn(screen==='confirm'?'confirm':'home');setPicker(field);setQuery('');setHits(null);go('search')}
 async function search(e){e?.preventDefault();if(!query.trim())return;const id=++request.current;setBusy(true);setError('');try{const matches=saved.filter(p=>[p.alias,p.name,p.address].some(t=>t?.includes(query)));const found=designDemo?[{name:'광화문',subtitle:'관광명소, 종로구',distance:'1.2km',address:'서울 종로구 사직로 161',latitude:37.5759,longitude:126.9768},{name:'광화문역 5호선',subtitle:'지하철역, 종로구',distance:'1.3km',address:'서울 종로구 세종대로',latitude:37.5716,longitude:126.9768}]:matches.length?matches:await searchWithFallback(query,locateCandidates);if(request.current===id)setHits(found)}catch(e){if(request.current===id)setError('장소 검색을 완료하지 못했어요. 검색 API 설정이나 주소를 확인해 주세요.')}finally{if(request.current===id)setBusy(false)}}
 useEffect(()=>{if(screen!=='search'||!query.trim())return;const timer=setTimeout(()=>void search(),350);return()=>clearTimeout(timer)},[query,screen]);
 function choose(place,field=picker){
  if(field==='save'){void save(place);return}
  setDemo(designDemo);
  // 일정에 적힌 위치 글자(예: '1공')에 대해 실제 장소를 고른 것이면 그 글자로 기억한다.
  // 다음에 같은 글자가 나오면 검색 없이 이 장소를 쓴다.
  const alias=event?.location?.trim();
  if(field==='destination'&&!designDemo&&alias&&form.destination.trim()===alias){
   setToast(`‘${alias}’은(는) 이 장소로 기억할게요.`);
   void persistPlace(alias,place);
  }
  setPoints(previous=>({...previous,[field]:place}));
  update(field,place.name||place.address);
  go(field==='origin'&&!form.destination?'home':'confirm');
 }
 async function persistPlace(alias,place){
  const session=readSession();
  if(!session){disconnect();return false}
  saveLocal(alias,place);
  setSaved(savedPlaces());
  try{await pushMyPlaces(session.token)}
  catch{if(readSession()?.token===session.token)setToast('이 브라우저에만 변경 사항을 저장했어요.')}
  return readSession()?.token===session.token;
 }
 async function save(place){
  const alias=place.alias||place.name||place.address;
  if(designDemo){setSaved(items=>[...items,{...place,alias}]);go('saved');return}
  setBusy(true);
  try{if(await persistPlace(alias,place))go('saved')}
  catch(error){setError(error.message)}
  finally{setBusy(false)}
 }
 async function remove(place){
  if(designDemo){setSaved(items=>items.filter(item=>item!==place));return}
  setBusy(true);
  try{await persistPlace(place.alias,null)}
  catch(error){setError(error.message)}
  finally{setBusy(false)}
 }
 function selectEvent(e){if(!e?.location)return;setExpanded(false);setLevel(null);setConditionChanged(false);setEvent(e);setDemo(designDemo);setPoints(p=>({...p,destination:null}));setForm(f=>({...f,preferences:onboarding.preferences,destination:e.location,departure:designDemo?form.departure:kstNow(),arrival:localInput(new Date(Date.parse(e.start.dateTime)-onboarding.preferences.arrivalBufferMinutes*60000))}));go('confirm')}
 async function condition(){
  const id=++request.current;
  try {
   makeTrip({...form,preferences:{...onboarding.preferences,avoidLine:avoidLine||null}},event,level);
   if(!designDemo){
    setBusy(true);
    for(const field of ['origin','destination']) {
     if(points[field])continue;
     const known=saved.filter(p=>[p.alias,p.name,p.address].includes(form[field]));
     const candidates=known.length?known:await searchWithFallback(form[field],locateCandidates);
     if(request.current!==id)return;
     if(candidates.length!==1){setPicker(field);setSearchReturn('confirm');setQuery(form[field]);setHits(candidates);go('search');return}
     setPoints(p=>({...p,[field]:candidates[0]}));
    }
   }
   if(level===null)setLevel(designDemo?3:suggestedLevel(events,new Date()));
   go('condition');
  }catch(e){if(request.current===id){setError(e.message);setBusy(false)}}
 }
 async function routes(withStops=false,overrideLevel=level){
  const id=++request.current;
  retry.current={withStops,level:overrideLevel};
  setBusy(true);
  setError('');
  setDwell(false);
  setScreen('loading');
  try {
   const t=makeTrip({...form,preferences:{...onboarding.preferences,avoidLine:avoidLine||null}},event,overrideLevel);
   setTrip(t);
   if(!withStops){setDepartureAlert(null);setRoute(null)}
   const r=designDemo?designRoutes(t,stay):await queryRoutes(t,{places:points,previous:result,stops:withStops,saved,stayMinutes:stay});
   if(id!==request.current)return;
   setResult(r);
   setStopIndex(0);
   if(withStops){
    setRoute(directChoice??r.direct[0]);
    setScreen('stops');
   }else{
    setRoute(r.direct[0]??null);
    setDirectChoice(r.direct[0]??null);
    setScreen('routes');
   }
  }catch(error){
   if(id===request.current){setError(error.message);setScreen('route-error')}
  }finally{if(id===request.current)setBusy(false)}
 }
 async function currentLocation(){const id=++request.current;setBusy(true);setError('');try{if(!navigator.geolocation)throw new Error('현재 위치를 지원하지 않는 브라우저예요.');const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{timeout:10000}));const {latitude,longitude}=pos.coords;const data=await api(`/api/reverse-geocode?latitude=${latitude}&longitude=${longitude}`);if(id!==request.current)return;const address=data.documents?.[0]?.road_address?.address_name||data.documents?.[0]?.address?.address_name;if(!address)throw new Error('주소를 확인하지 못했어요. 출발지를 검색해 주세요.');choose({name:'현재 위치',address,latitude,longitude},'origin')}catch(e){if(id===request.current)setError(e.code===1?'위치 권한이 꺼져 있어요. 출발지를 직접 검색해 주세요.':e.message)}finally{if(id===request.current)setBusy(false)}}
 function navigate(link){
  const opened=window.open('','_blank');
  if(opened){opened.opener=null;opened.location.replace(link.url);return}
  setToast('지도 창이 차단됐어요. 지도 링크를 복사하거나 직접 열어 주세요.');
 }
 async function copyLink(link){
  try{await navigator.clipboard.writeText(link.url);setToast('지도 링크를 복사했어요.')}
  catch{setToast('링크를 복사하지 못했어요. 길안내 링크를 직접 열어 주세요.')}
 }
 const mapScreen=['home','routes','loading','route-error','stops','waypoint','waypoint-confirmed'].includes(screen);
 const navScreen=screen==='my'||screen==='home'&&!expanded;
 const title={details:'경로 상세',my:'내 정보',saved:'내 장소',settings:'캘린더 설정',search:picker==='origin'?'출발 위치 선택':''}[screen]||'';
 const activeStop=result?.stops[stopIndex]??null;
 const chooseRoute=()=>{
  if(trip?.arriveBy)void routes(true);
  else go('details');
 };
 return <div className={`app ${mapScreen?'has-map':''} ${navScreen?'has-nav':''}`}><main className={`screen screen-${screen}`}>
 {mapScreen&&(designDemo?<MapSurface routes={screen!=='home'} demo={demo} state={screen}/>:<LiveMap state={screen} points={points} route={['loading','route-error','home'].includes(screen)?null:screen==='waypoint'?activeStop:route} candidate={screen==='stops'?activeStop?.place:null}/>)}
 {!mapScreen&&screen!=='welcome'&&screen!=='onboarding'&&!(screen==='search'&&picker==='destination')&&<AppBar title={title} back={()=>go(screen==='calendar'?'welcome':screen==='settings'?'my':returnTo)}/>}
 {screen==='welcome'&&<Welcome login={calendar} busy={busy}/>}
 {screen==='onboarding'&&linked&&<Onboarding initial={onboarding.preferences} onComplete={finishOnboarding}/>}
 {screen==='calendar'&&<CalendarIntro state={calendarState} busy={busy} connect={calendar} error={error}/>}
 {screen==='home'&&<><div className="map-controls"><button className="search-bar" onClick={()=>{setEvent(null);setLevel(null);setConditionChanged(false);update('arrival','');openSearch()}}><Icon name="search"/>목적지를 검색하세요</button><button className="pill" onClick={()=>go('saved')}><Icon name="bookmark"/>내 장소</button></div><button className={`locate ${!linked?'unlinked':upcoming.length?'with-event':'no-events'}`} aria-label="현재 위치로 설정" onClick={currentLocation}><Icon name="locate"/></button><Sheet className={!linked?'home-unlinked':upcoming.length?'home-event':'home-empty'}>{!linked?<><div className="sheet-body"><h2>다음 약속을 불러올까요?</h2><p>캘린더를 연결하면 일정으로 바로 길을 찾아요.</p><Button kind="sky" onClick={()=>go('calendar')}>캘린더 연결하기</Button></div></>:upcoming.length?<div className="sheet-body"><p className="subheading">다가오는 일정</p>{(expanded?upcoming:upcoming.filter(item=>item.location).slice(0,1)).map((e,i)=><button className={`event-row ${event===e?'selected':''}`} key={e.id||i} disabled={!e.location} onClick={()=>{setEvent(e);if(expanded)selectEvent(e);else setExpanded(true)}}><span><small>{e.start.dateTime.slice(0,10)===kstNow().slice(0,10)?'오늘':e.start.dateTime.slice(5,10).replace('-','/')}</small><strong>{clock(e.start.dateTime)}</strong></span><span><strong>{e.summary||'다음 약속'}</strong><small>{e.location||'장소가 없어요'}</small></span></button>)}<Button disabled={!upcoming.some(item=>item.location)} onClick={()=>expanded?selectEvent(event?.location?event:upcoming.find(item=>item.location)):setExpanded(true)}>길 찾기</Button></div>:<div className="sheet-body"><Art name="no-events"/><h2>다가오는 일정이 없어요.</h2><p>목적지를 검색해 길을 찾아보세요.</p><Button onClick={()=>openSearch()}>목적지 검색</Button></div>}</Sheet></>}
 {screen==='search'&&<section className={`search-page ${picker==='origin'?'origin-picker':''}`}><form onSubmit={search} className="search-form"><Icon name="search"/><input aria-label="장소 이름 또는 주소" placeholder={picker==='origin'?'출발지를 검색하세요':'목적지를 검색하세요'} autoFocus value={query} onChange={e=>{request.current++;setBusy(false);setQuery(e.target.value);setHits(null)}}/><button type="button" aria-label="검색 닫기" onClick={()=>go(returnTo)}><Icon name="close"/></button></form>{picker==='origin'&&<><button className="origin-current" disabled={busy} onClick={currentLocation}><Icon name="locate"/>현재 위치로 설정</button><p className="search-label">내 장소</p></>}{(hits??saved).map((p,i)=><PlaceRow key={i} place={p} onClick={()=>choose(p)} tail={p.distance}/>)}{hits?.length===0&&<p className="search-message">검색 결과가 없어요. 지역명이나 주소를 함께 입력해 주세요.</p>}{busy&&<p className="search-message" role="status">장소를 확인하고 있어요…</p>}</section>}
 {screen==='confirm'&&<section className="page confirm-page"><h1>이동 정보를 확인해 주세요.</h1><div className="field-list"><Field label="출발" value={form.origin||'출발 위치 선택'} onClick={()=>openSearch('origin')}/><Field label="도착" value={form.destination||'목적지 선택'} onClick={()=>openSearch('destination')}/>{event&&<Field label="약속 시간" value={clock(event.start.dateTime)}/>}<Field label="출발 시간" value={clock(fromInput(form.departure)??new Date())} onClick={()=>openTime('departure')}/><Field label="도착 목표" value={form.arrival?clock(fromInput(form.arrival)):'도착 목표 없음'} error={Boolean(timeError)} onClick={()=>openTime('arrival')}/>{(error||timeError)&&<p className="field-error">{error||timeError}</p>}</div><Actions><Button disabled={busy||Boolean(timeError)||!form.origin||!form.destination} onClick={condition}>컨디션 확인</Button></Actions></section>}
 {screen==='condition'&&<section className="page condition-page"><h1>{scale.title}</h1>{!conditionChanged&&<p>{level!==null?'일정을 참고해 미리 골랐어요.':'지금 컨디션을 골라 주세요.'}</p>}<FatigueScale value={level} onChange={value=>{setLevel(value);setConditionChanged(true)}}/>
 <label className="avoid-line">가능하면 피할 지하철 노선
  <select value={avoidLine} onChange={event=>setAvoidLine(event.target.value)}>
   <option value="">선택 안 함</option>
   {[1,2,3,4,5,6,7,8,9].map(line=><option key={line} value={line}>{line}호선</option>)}
  </select>
 </label><Actions><Button disabled={busy||level===null} onClick={()=>routes(false)}>경로 보기</Button><Button kind="text" disabled={busy} onClick={()=>{setLevel(null);setConditionChanged(true);routes(false,null)}}>건너뛰기</Button></Actions></section>}
 {screen==='loading'&&<Sheet className="loading-sheet"><div className="sheet-body"><h2>경로를 찾고 있어요.</h2><div className="skeleton"/><div className="skeleton"/></div><Actions><Button disabled><Icon name="refresh"/></Button></Actions></Sheet>}
 {screen==='routes'&&<RouteComparison result={result} route={route} trip={trip} demo={demo} select={item=>{setRoute(item);setDirectChoice(item)}} choose={chooseRoute} changeCondition={()=>go('condition')} changeTrip={()=>go('confirm')} showLate={item=>{setRoute(item);go('details')}}/>}
 {screen==='route-error'&&<Sheet className="route-error-sheet"><div className="sheet-body"><Art name="route-error"/><h2>경로를 불러오지 못했어요.</h2><p>{error||'잠시 후 다시 시도해 주세요.'}</p></div><Actions><Button onClick={()=>routes(retry.current?.withStops,retry.current?.level)}>다시 시도</Button><Button kind="text" onClick={()=>go('confirm')}>출발 조건 변경</Button></Actions></Sheet>}
 {screen==='stops'&&<Sheet className="recommendation-sheet"><div className="sheet-body"><div className="heading-row"><h2>{activeStop?'가는 길에 들를 만한 곳이 있어요.':'지금은 바로 가는 게 좋겠어요.'}</h2>{demo&&<Badge/>}</div>{activeStop?<PlaceRow place={activeStop.place} onClick={()=>go('waypoint')} tail={activeStop.place.detourDistance}/>:<p>조건에 맞는 장소를 찾지 못했어요.</p>}</div><Actions>{activeStop&&<Button onClick={()=>go('waypoint')}>장소 보기</Button>}<Button kind={activeStop?'text':'primary'} onClick={()=>{setRoute(directChoice??result.direct[0]);go('details')}}>바로 가기</Button></Actions></Sheet>}
 {screen==='waypoint'&&activeStop&&<Sheet className="waypoint-sheet"><div className="sheet-body"><div className="heading-row"><h2>여기 들러볼까요?</h2>{demo&&<Badge/>}</div><PlaceRow place={activeStop.place} onClick={()=>{}} tail={activeStop.place.detourDistance}/><dl className="metrics"><div><dt>이동 시간</dt><dd>{activeStop.travelMinutes}분</dd></div><div><dt>체류 시간</dt><dd>{activeStop.stayMinutes}분</dd></div><div><dt>도착 시간</dt><dd>{clock(activeStop.arrivalAt)}</dd></div></dl><p className="waypoint-hint">{Math.max(0,activeStop.extraTravelMinutes)}분 더 이동하면 {activeStop.stayMinutes}분 머물 수 있어요.</p></div><Actions><Button onClick={()=>{setRoute(activeStop);go('waypoint-confirmed')}}>이곳 들르기</Button><Button kind="secondary" onClick={()=>setStopIndex(i=>(i+1)%result.stops.length)} hidden={result.stops.length<2}>다른 곳 보기</Button><Button kind="text" onClick={()=>go('stops')}>닫기</Button></Actions></Sheet>}
 {screen==='waypoint-confirmed'&&route&&<Sheet className="waypoint-confirmed-sheet"><div className="sheet-body"><div className="heading-row"><h2>{route.place.name}에 들르는 길이에요.</h2>{demo&&<Badge/>}</div><dl className="metrics"><div><dt>이동 시간</dt><dd>{route.travelMinutes}분</dd></div><div><dt>체류 시간</dt><dd>{route.stayMinutes}분</dd></div><div><dt>도착 시간</dt><dd>{clock(route.arrivalAt)}</dd></div></dl></div><Actions><Button onClick={()=>go('details')}>경로 상세 보기</Button><Button kind="text" onClick={()=>{setRoute(directChoice??result.direct[0]);go('details')}}>경유지 빼기</Button></Actions></Sheet>}
 {screen==='details'&&route&&<RouteDetails route={route} trip={trip} demo={demo} navigate={navigate} copyLink={copyLink} openDwell={()=>setDwell(true)}/>}
 {screen==='my'&&<section className="page list-page"><ListRow title="내 장소" subtitle="저장한 장소 관리" onClick={()=>go('saved')}/><ListRow title="캘린더 설정" subtitle="Google 캘린더 연결" onClick={()=>go('settings')}/></section>}
 {screen==='settings'&&<section className="page list-page"><ListRow title="Google 캘린더" subtitle="일정은 읽기만 해요." tail={<small>연결됨</small>}/><ListRow title="약속 장소가 있는 일정만 보기" onClick={()=>setLocatedOnly(v=>!v)} tail={<span className={`toggle ${locatedOnly?'on':''}`} role="switch" aria-checked={locatedOnly} aria-label="약속 장소가 있는 일정만 보기"/>}/><Actions><Button kind="danger" onClick={disconnect}>연결 해제 및 로그아웃</Button></Actions></section>}
 {screen==='saved'&&<section className={`page saved-page ${saved.length?'':'empty'}`}>{saved.length?saved.map((p,i)=><div className="saved-place-row" key={p.alias||i}><PlaceRow place={p} onClick={()=>{setEvent(null);update('arrival','');choose(p,'destination')}} tail={p.distance}/><button aria-label={`${p.alias||p.name} 삭제`} disabled={busy} onClick={()=>remove(p)}>삭제</button></div>):<><Art name="empty-saved"/><h2>저장한 장소가 없어요.</h2><p>자주 가는 곳을 저장해 두면 빠르게 찾을 수 있어요.</p></>}<Actions><Button kind="sky" onClick={()=>openSearch('save')}>장소 추가</Button></Actions></section>}
 {error&&!['confirm','route-error','calendar'].includes(screen)&&<div className="toast" role="alert">{error}<button onClick={()=>setError('')} aria-label="오류 안내 닫기">×</button></div>}
 </main>{navScreen&&<nav><button className={screen==='home'?'active':''} onClick={()=>go('home')}><Icon name="map"/>지도</button><button className={screen==='my'?'active':''} onClick={()=>go('my')}><Icon name="user"/>마이</button></nav>}
 {toast&&<div className="toast" role="status">{toast}</div>}
 {linked&&departureAlert&&<aside className="departure-notice" aria-label="출발 알림">
  <strong>지금 출발할 시간이에요</strong>
  <span>{departureAlert.title} · {departureAlert.location}</span>
  <button onClick={()=>{setDepartureAlert(null);go('details')}}>경로 보기</button>
  <button onClick={()=>setDepartureAlert(null)} aria-label="출발 알림 닫기">×</button>
 </aside>}
 {dwell&&<div className="overlay"><Sheet className="dwell-sheet"><div role="dialog" aria-modal="true" aria-label="체류 시간 선택"><div className="sheet-body"><h2>얼마나 머물 수 있나요?</h2><p>도착 목표가 없어서 머무는 시간을 먼저 알려 주세요.</p></div><div className="chips">{[10,20,30,60].map(n=><button key={n} className={stay===n?'selected':''} onClick={()=>setStay(n)}>{n===60?'1시간':`${n}분`}</button>)}</div><Actions><Button disabled={busy} onClick={()=>routes(true)}>{busy?'찾고 있어요…':'들를 곳 찾기'}</Button><Button kind="text" onClick={()=>{request.current++;setBusy(false);setDwell(false)}}>취소</Button></Actions></div></Sheet></div>}
 {timePicker&&<div className="overlay"><Sheet className="time-sheet"><div role="dialog" aria-modal="true" aria-label={timePicker==='departure'?'출발 시각':'도착 목표'}><div className="sheet-body"><h2>{timePicker==='departure'?'출발 시각':'도착 목표'}</h2></div><div className="time-wheels"><div className="wheel-highlight"/>{[['ampm',['오전','오후']],['hour',Array.from({length:12},(_,i)=>String(i+1))],['minute',Array.from({length:12},(_,i)=>String(i*5).padStart(2,'0'))]].map(([part,items])=><TimeWheel key={part} label={part==='ampm'?'오전 오후':part==='hour'?'시':'분'} items={items} value={timeDraft[part]} onChange={v=>setTimeDraft(t=>({...t,[part]:v}))}/>)}</div>{timePicker==='arrival'&&event&&<p className="wheel-hint">약속 시각 {clock(event.start.dateTime)} 이전으로만 정할 수 있어요.</p>}<Actions>{timePicker==='departure'&&<Button kind="sky" onClick={()=>{update('departure',kstNow());setTimePicker(null)}}>지금</Button>}<Button onClick={commitTime}>확인</Button>{timePicker==='arrival'&&<Button kind="text" onClick={()=>{update('arrival','');setTimePicker(null)}}>도착 목표 없이 진행</Button>}</Actions></div></Sheet></div>}
 </div>
}
