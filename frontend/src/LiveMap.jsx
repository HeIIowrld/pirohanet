import React, {useEffect, useMemo, useRef, useState} from 'react';

const center = {latitude:37.5665, longitude:126.978};
const authFailure = 'modo:naver-map-auth-failure';
const modeColors = {BUS:'--state-success', SUBWAY:'--brand-sky-deep', WALKING:'--walk'};
const lineColors = {'2호선':'--line-2','5호선':'--line-5'};

function strokeToken(step) {
  return lineColors[step.vehicles?.[0]?.name] ?? modeColors[step.type] ?? '--walk';
}
let sdkPromise;

function loadNaverMaps() {
  sdkPromise ??= (async () => {
    const response = await fetch('/assets/map-config.json', {signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('지도 설정을 가져오지 못했어요.');
    const {naverClientId} = await response.json();
    if (!naverClientId) throw new Error('네이버 지도 클라이언트 ID가 없어요.');
    const url = new URL('https://oapi.map.naver.com/openapi/v3/maps.js');
    url.searchParams.set('ncpKeyId',naverClientId);
    const existing = window.navermap_authFailure;
    window.navermap_authFailure = (...args) => {
      window.dispatchEvent(new Event(authFailure));
      existing?.(...args);
    };
    return new Promise((resolve,reject) => {
      const script = document.createElement('script');
      script.src = url;
      function finish(error) {
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
      script.onload = () => finish(window.naver?.maps?.Map ? null : new Error('네이버 지도 SDK를 초기화하지 못했어요.'));
      script.onerror = () => finish(new Error('네이버 지도 SDK를 불러오지 못했어요.'));
      document.head.append(script);
    });
  })();
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
    const points = (step.points ?? []).filter(isCoordinate);
    return points.length > 1 ? [{points,color:strokeToken(step),walk:step.type === 'WALKING'}] : [];
  });
  return {markers,lines};
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
    {data.lines.map((line,index) => <polyline key={index} fill="none" stroke={`var(${line.color})`} strokeWidth="4"
      strokeDasharray={line.walk?'4 5':undefined} points={line.points.map(point => plot(point).join(',')).join(' ')}/>)}
    {data.markers.map(({point,label}) => {
      const [x,y]=plot(point);
      return <g key={label} transform={`translate(${x},${y})`}>
        <circle r="6" fill="var(--brand-sky-deep)" stroke="var(--bg-canvas)" strokeWidth="2"/>
        <text x="0" y="-12" textAnchor="middle" fill="var(--fg-default)">{label}</text>
      </g>;
    })}
  </svg>;
}

function StreetMap({data}) {
  const host = useRef(null);
  const map = useRef(null);
  const [library,setLibrary] = useState(null);
  const [failed,setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let loadTimeout;
    void import('./street-map.js').then((leaflet) => {
      if (!active) return;
      map.current = leaflet.createStreetMap(host.current);
      loadTimeout = setTimeout(() => setFailed(true),8000);
      map.current.tiles.once('tileload',() => {
        clearTimeout(loadTimeout);
        if (active) setFailed(false);
      });
      setLibrary(leaflet);
    }).catch(() => { if(active)setFailed(true) });
    return () => {
      active = false;
      clearTimeout(loadTimeout);
      map.current?.view.remove();
    };
  }, []);
  useEffect(() => {
    if (!library) return;
    return library.drawStreetRoute(map.current.view,data);
  }, [library,data]);
  return <>
    <div ref={host} className="live-map-canvas" hidden={failed}/>
    {failed ? <><RouteSketch data={data}/><p className="map-message">지도 배경을 불러오지 못했어요.</p></> :
      <a className="street-map-credit" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>}
  </>;
}

export default function LiveMap({points,route,candidate,state,position}) {
  const host = useRef(null);
  const map = useRef(null);
  const [sdk,setSdk] = useState(null);
  const [ready,setReady] = useState(false);
  const [unavailable,setUnavailable] = useState(false);
  const data = useMemo(() => mapData(points,route,candidate,position), [points,route,candidate,position]);

  useEffect(() => {
    let active = true;
    const onFailure = () => setUnavailable(true);
    window.addEventListener(authFailure,onFailure);
    void loadNaverMaps().then(value => {if(active)setSdk(value)})
      .catch(() => {if(active)setUnavailable(true)});
    return () => {
      active = false;
      window.removeEventListener(authFailure,onFailure);
    };
  }, []);

  useEffect(() => {
    if (!sdk || unavailable) return;
    const node = host.current;
    const timer = setTimeout(() => setUnavailable(true),9000);
    try {
      const canvas = new sdk.Map(node, {
        center:new sdk.LatLng(center.latitude,center.longitude),
        zoom:13, scrollWheel:false, zoomControl:false,
      });
      map.current = canvas;
      const listener = sdk.Event.addListener(canvas,'tilesloaded',() => {
        clearTimeout(timer);
        setReady(true);
      });
      return () => {
        clearTimeout(timer);
        sdk.Event.removeListener(listener);
        canvas.destroy();
        map.current = null;
      };
    } catch {
      clearTimeout(timer);
      setUnavailable(true);
    }
  }, [sdk,unavailable]);

  useEffect(() => {
    if (!sdk || unavailable) return;
    const node = host.current;
    const canvas = map.current;
    const screen = node.closest('.screen');
    if (!canvas || !screen) return;
    const sheet = screen.querySelector('.sheet');
    const fitMap = () => {
      const height = sheet
        ? sheet.getBoundingClientRect().top - node.getBoundingClientRect().top
        : screen.clientHeight;
      if (height > 0 && node.clientHeight !== Math.round(height)) {
        node.style.height = Math.round(height) + 'px';
      }
      canvas.autoResize();
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
  }, [sdk,data,state,unavailable]);

  useEffect(() => {
    if (!sdk || unavailable || !map.current) return;
    const canvas = map.current;
    const position = ([longitude,latitude]) => new sdk.LatLng(latitude,longitude);
    const palette = getComputedStyle(host.current);
    const overlays = data.lines.map(line => new sdk.Polyline({
      map:canvas, path:line.points.map(position), strokeWeight:5,
      strokeColor:palette.getPropertyValue(line.color).trim(), strokeOpacity:.9,
      strokeStyle:line.walk?'shortdash':'solid', strokeLineCap:'round', strokeLineJoin:'round',
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
      if (map.current === canvas) overlays.forEach(overlay => overlay.setMap(null));
    };
  }, [sdk,data,unavailable]);

  return <div className="map-placeholder live-map" aria-label="이동 지도">
    <div ref={host} className="live-map-canvas naver-map-canvas" data-provider={ready&&!unavailable?'naver':undefined} hidden={unavailable}/>
    {!sdk && !unavailable && <RouteSketch data={data}/>}
    {unavailable && <StreetMap data={data}/>}
  </div>;
}
