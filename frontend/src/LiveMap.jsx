import React, {useEffect, useMemo, useRef, useState} from 'react';

const center = {latitude:37.5665, longitude:126.978};
const colors = {BUS:'#158352', SUBWAY:'#187299', WALKING:'#586775'};
let sdkPromise;

function loadKakaoMaps() {
  sdkPromise ??= (async () => {
    const response = await fetch('/assets/map-config.json', {signal:AbortSignal.timeout(5000)});
    if (!response.ok) throw new Error('Map configuration unavailable');
    const {kakaoJavaScriptKey} = await response.json();
    if (!kakaoJavaScriptKey) throw new Error('Map key unavailable');
    const url = new URL('https://dapi.kakao.com/v2/maps/sdk.js');
    url.search = new URLSearchParams({appkey:kakaoJavaScriptKey, autoload:'false'});
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      const timer = setTimeout(reject, 7000);
      script.onload = () => {clearTimeout(timer); resolve()};
      script.onerror = () => {clearTimeout(timer); reject()};
      document.head.append(script);
    });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(reject, 7000);
      window.kakao.maps.load(() => {clearTimeout(timer); resolve(window.kakao.maps)});
    });
  })();
  return sdkPromise;
}

function isCoordinate(point) {
  return point?.length === 2 && point.every(Number.isFinite) &&
    Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}

function mapData(points, route, candidate) {
  const markers = [[points.origin,'출발'], [points.destination,'도착'], [route?.place ?? candidate,'경유']]
    .flatMap(([place,label]) => {
      const point = [place?.longitude,place?.latitude];
      return isCoordinate(point) ? [{point,label}] : [];
    });
  const lines = (route?.steps ?? []).flatMap(step => {
    const points = (step.points ?? []).filter(isCoordinate);
    return points.length > 1 ? [{points,color:colors[step.type] ?? colors.WALKING,walk:step.type === 'WALKING'}] : [];
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
    {data.lines.map((line,index) => <polyline key={index} fill="none" stroke={line.color} strokeWidth="4"
      strokeDasharray={line.walk?'4 5':undefined} points={line.points.map(point => plot(point).join(',')).join(' ')}/>)}
    {data.markers.map(({point,label}) => {
      const [x,y]=plot(point);
      return <g key={label} transform={`translate(${x},${y})`}>
        <circle r="6" fill="#177295" stroke="white" strokeWidth="2"/>
        <text x="0" y="-12" textAnchor="middle" fill="#173946">{label}</text>
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

export default function LiveMap({points,route,candidate}) {
  const host = useRef(null);
  const [sdk,setSdk] = useState(null);
  const map = useRef(null);
  const [unavailable,setUnavailable] = useState(false);
  const data = useMemo(() => mapData(points,route,candidate), [points,route,candidate]);
  useEffect(() => {
    let active = true;
    void loadKakaoMaps().then(value => {if(active)setSdk(value)})
      .catch(() => {if(active)setUnavailable(true)});
    return () => {active = false};
  }, []);
  useEffect(() => {
    if (!sdk) return;
    const position = ([x,y]) => new sdk.LatLng(y,x);
    try {
      map.current ??= new sdk.Map(host.current,{center:position([center.longitude,center.latitude]),level:6,draggable:false,scrollwheel:false});
      const canvas = map.current;
      const bounds = new sdk.LatLngBounds();
      const overlays = [];
      for (const {point,label} of data.markers) {
        const pin = document.createElement('span');
        pin.className = 'live-map-pin';
        pin.textContent = label;
        const latLng = position(point);
        bounds.extend(latLng);
        overlays.push(new sdk.CustomOverlay({map:canvas,position:latLng,content:pin,yAnchor:1}));
      }
      for (const line of data.lines) {
        const path = line.points.map(position);
        path.forEach(point => bounds.extend(point));
        overlays.push(new sdk.Polyline({map:canvas,path,strokeWeight:5,strokeColor:line.color,
          strokeOpacity:.9,strokeStyle:line.walk?'shortdash':'solid'}));
      }
      if (data.lines.length || data.markers.length > 1) canvas.setBounds(bounds,110,30,320,30);
      else if (data.markers.length === 1) canvas.setCenter(position(data.markers[0].point));
      return () => overlays.forEach(overlay => overlay.setMap(null));
    } catch {
      setUnavailable(true);
    }
  }, [sdk,data]);
  return <div className="map-placeholder live-map" aria-label="이동 지도">
    <div ref={host} className="live-map-canvas" hidden={unavailable}/>
    {!sdk && !unavailable && <RouteSketch data={data}/>}
    {unavailable && <StreetMap data={data}/>}
  </div>;
}
