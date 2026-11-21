import React, {useEffect, useMemo, useRef, useState} from 'react';
import {addRailGeometry,addMapGeometry,mapStepPoints} from './route-geometry.js';
import {routeColor} from './route-colors.js';

const center = {latitude:37.5665, longitude:126.978};
const authFailure = 'modo:naver-map-auth-failure';
let sdkPromise;

function loadNaverMaps() {
  if (sdkPromise) return sdkPromise;
  if (window.naver?.maps?.Map) return Promise.resolve(window.naver.maps);
  sdkPromise = (async () => {
    const response = await fetch('/assets/map-config.json', {signal:AbortSignal.timeout(5000)})
      .catch(() => null);
    if (!response?.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new Error('지도 설정을 가져오지 못했어요.');
    }
    const config = await response.json().catch(() => null);
    const naverClientId = config?.naverClientId;
    if (typeof naverClientId !== 'string' || !naverClientId.trim()) {
      throw new Error('네이버 지도 클라이언트 ID를 확인해 주세요.');
    }
    const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
    url.searchParams.set('ncpKeyId',naverClientId.trim());
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      let settled = false;
      script.src = url;
      function finish(error) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        script.onload = null;
        script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else {
          resolve(window.naver.maps);
        }
      }
      const timer = setTimeout(() => finish(new Error('네이버 지도 응답이 지연됐어요.')),7000);
      window.navermap_authFailure = () => {
        script.remove();
        finish(new Error('네이버 지도 인증에 실패했어요.'));
        window.dispatchEvent(new Event(authFailure));
      };
      script.onload = () => finish(window.naver?.maps?.Map ? null : new Error('네이버 지도 SDK를 초기화하지 못했어요.'));
      script.onerror = () => finish(new Error('네이버 지도 SDK를 불러오지 못했어요.'));
      document.head.append(script);
    });
  })().finally(() => { sdkPromise = undefined; });
  return sdkPromise;
}

function isCoordinate(point) {
  return point?.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

function mapData(points, route, candidate, position) {
  const markers = [[points.origin,'출발'], [points.destination,'도착'], [route?.place ?? candidate,'경유'], [position,'내 위치']]
    .flatMap(([place,label]) => {
      const point = [place?.longitude,place?.latitude];
      return isCoordinate(point) ? [{point,label}] : [];
    });
  const lines = (route?.steps ?? []).flatMap(step => {
    const points = mapStepPoints(step).filter(isCoordinate);
    return points.length > 1 ? [{points,color:routeColor(step),walking:step.type === 'WALKING',approximate:step.approximate}] : [];
  });
  return {markers,lines,osmGeometry:route?.steps?.some(step => step.osmGeometry),gbisGeometry:route?.steps?.some(step => step.gbisGeometry),
    incheonGeometry:route?.steps?.some(step => step.incheonGeometry)};
}

function RouteSketch({data}) {
  const coords = [...data.markers.map(item => item.point), ...data.lines.flatMap(line => line.points)];
  if (!coords.length) return null;
  const xs = coords.map(point => point[0]);
  const ys = coords.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxY = Math.max(...ys);
  const dx = Math.max(0.002, Math.max(...xs)-minX);
  const dy = Math.max(0.002, maxY-Math.min(...ys));
  const plot = ([x,y]) => [48+294*(x-minX)/dx, 122+190*(maxY-y)/dy];
  return <svg className="route-sketch" viewBox="0 0 390 360" aria-label="대중교통 경로 개요" role="img">
    {data.lines.map((line,index) => <polyline key={index} fill="none" stroke={line.color} strokeWidth="4"
      strokeDasharray={line.walking ? '3 6' : undefined} strokeLinecap="round"
      strokeOpacity={line.approximate ? 0.65 : 0.95} points={line.points.map(point => plot(point).join(',')).join(' ')}/>)}
    {data.markers.map(({point,label}) => {
      const [x,y]=plot(point);
      return <g key={label} transform={`translate(${x},${y})`}>
        <circle r="6" fill="var(--brand-sky-deep)" stroke="var(--bg-canvas)" strokeWidth="2"/>
        <text x="0" y="-12" textAnchor="middle" fill="var(--fg-default)">{label}</text>
      </g>;
    })}
  </svg>;
}

function hasNaverCanvas(sdk,node) {
  // On auth failure the SDK empties the map container and then clears its namespace.
  return window.naver?.maps === sdk && node.hasChildNodes();
}

export default function LiveMap({points,route,candidate,state,position}) {
  const host = useRef(null);
  const map = useRef(null);
  const [sdk,setSdk] = useState(null);
  const [ready,setReady] = useState(false);
  const [loadError,setLoadError] = useState('');
  const [attempt,setAttempt] = useState(0);
  const [streetGeometry,setStreetGeometry] = useState(null);
  const railGeometry = useMemo(() => addRailGeometry(route),[route]);
  const mapRoute = streetGeometry?.original === railGeometry ? streetGeometry?.route : railGeometry;
  const data = useMemo(() => mapData(points,mapRoute,candidate,position), [points,mapRoute,candidate,position]);

  useEffect(() => {
    if (!railGeometry?.steps?.some(step => step.approximate && ['WALKING','BUS','SUBWAY'].includes(step.type))) return;
    const controller = new AbortController();
    void addMapGeometry(railGeometry,controller.signal).then(result => {
      if (!controller.signal.aborted) setStreetGeometry({original:railGeometry,route:result});
    });
    return () => controller.abort();
  }, [railGeometry]);

  useEffect(() => {
    let active = true;
    const onFailure = () => setLoadError('네이버 지도 인증에 실패했어요.');
    window.addEventListener(authFailure,onFailure);
    void loadNaverMaps().then(value => {
      if (!active) return;
      if (window.naver?.maps === value) setSdk(value);
      else onFailure();
    }).catch(error => {
      if (active) setLoadError(error.message);
    });
    return () => {
      active = false;
      window.removeEventListener(authFailure,onFailure);
    };
  }, [attempt]);

  useEffect(() => {
    if (!sdk || loadError) return;
    const node = host.current;
    const timer = setTimeout(() => setLoadError('네이버 지도 타일을 불러오지 못했어요.'),9000);
    try {
      const canvas = new sdk.Map(node, {
        center:new sdk.LatLng(center.latitude,center.longitude),
        zoom:13, scrollWheel:false, zoomControl:false,
      });
      map.current = canvas;
      const listener = sdk.Event.addListener(canvas,'tilesloaded',() => {
        // The SDK can emit tilesloaded even when every tile request failed.
        const hasTile = Array.from(node.querySelectorAll('img')).some(image =>
          image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256);
        if (!hasTile) return;
        clearTimeout(timer);
        setReady(true);
      });
      return () => {
        clearTimeout(timer);
        map.current = null;
        if (hasNaverCanvas(sdk,node)) {
          sdk.Event.removeListener(listener);
          canvas.destroy();
        }
      };
    } catch {
      clearTimeout(timer);
      setLoadError('네이버 지도를 초기화하지 못했어요.');
    }
  }, [sdk,loadError]);

  useEffect(() => {
    if (!ready || loadError) return;
    const node = host.current;
    const canvas = map.current;
    const screen = node.closest('.screen');
    if (!canvas || !screen) return;
    const sheet = screen.querySelector('.sheet');
    const fitMap = () => {
      if (map.current !== canvas || !hasNaverCanvas(sdk,node)) return;
      const height = sheet
        ? sheet.getBoundingClientRect().top - node.getBoundingClientRect().top
        : screen.clientHeight;
      if (height > 0 && node.clientHeight !== Math.round(height)) {
        node.style.height = Math.round(height) + 'px';
      }
      canvas.autoResize();
      if (position) {
        canvas.setCenter(new sdk.LatLng(position.latitude,position.longitude));
        return;
      }
      const coordinates = [
        ...data.markers.map(({point}) => point),
        ...data.lines.flatMap(({points}) => points),
      ].map(([longitude,latitude]) => new sdk.LatLng(latitude,longitude));
      if (coordinates.length > 1) {
        canvas.fitBounds(coordinates,{top:40,right:30,bottom:26,left:30,maxZoom:16});
      } else if (coordinates.length === 1) {
        canvas.setCenter(coordinates[0]);
      }
    };
    fitMap();
    const resize = new ResizeObserver(fitMap);
    resize.observe(screen);
    if (sheet) resize.observe(sheet);
    return () => resize.disconnect();
  }, [sdk,data,state,position,ready,loadError]);

  useEffect(() => {
    if (!ready || loadError || !map.current) return;
    const node = host.current;
    if (!hasNaverCanvas(sdk,node)) return;
    const canvas = map.current;
    const position = ([longitude,latitude]) => new sdk.LatLng(latitude,longitude);
    const overlays = data.lines.map(line => new sdk.Polyline({
      map:canvas, path:line.points.map(position), strokeWeight:5,
      strokeColor:line.color, strokeOpacity:line.approximate ? 0.65 : 0.95,
      strokeStyle:line.walking ? 'shortdot' : 'solid', strokeLineCap:'round', strokeLineJoin:'round',
    }));
    for (const {point,label} of data.markers) {
      const pin = document.createElement('span');
      pin.className = 'live-map-pin';
      pin.dataset.kind = label;
      pin.textContent = label;
      overlays.push(new sdk.Marker({
        map:canvas, position:position(point), title:label,
        icon:{content:pin, anchor:new sdk.Point(19,28)},
      }));
    }
    return () => {
      if (map.current === canvas && hasNaverCanvas(sdk,node)) {
        overlays.forEach(overlay => overlay.setMap(null));
      }
    };
  }, [sdk,data,ready,loadError]);

  function retry() {
    setSdk(null);
    setReady(false);
    setLoadError('');
    setAttempt(number => number+1);
  }

  return <div className="map-placeholder live-map" aria-label="이동 지도">
    <div ref={host} className="live-map-canvas naver-map-canvas" data-provider={ready&&!loadError?'naver':undefined} hidden={Boolean(loadError)} inert={!ready||Boolean(loadError)}/>
    {!ready && !loadError && <RouteSketch data={data}/>}
    {(data.osmGeometry || data.gbisGeometry || data.incheonGeometry) && !loadError && <div className="route-shape-credit">
      {data.osmGeometry && <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
      {data.incheonGeometry && <a href="https://bus.incheon.go.kr/" target="_blank" rel="noreferrer">인천 버스정보</a>}
      {data.gbisGeometry && <a href="https://www.gbis.go.kr/" target="_blank" rel="noreferrer">경기버스정보</a>}
    </div>}
    {loadError && <div className="map-message">
      <p role="status">{loadError}</p>
      <button type="button" onClick={retry}>지도 다시 불러오기</button>
    </div>}
  </div>;
}
