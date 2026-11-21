import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const latLng = ([longitude,latitude]) => [latitude,longitude];

export function createStreetMap(host) {
  const view = L.map(host,{center:[37.5665,126.978],zoom:12,zoomControl:false,
    attributionControl:false,scrollWheelZoom:false});
  const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(view);
  return {view,tiles};
}

export function drawStreetRoute(view,{markers,lines}) {
  const group = L.featureGroup().addTo(view);
  for (const {point,label} of markers) {
    const pin = document.createElement('span');
    pin.className = 'live-map-pin';
    pin.dataset.kind = label;
    pin.textContent = label;
    L.marker(latLng(point),{title:label,icon:L.divIcon({className:'street-pin',html:pin,iconSize:[38,28],iconAnchor:[19,28]})}).addTo(group);
  }
  const palette = getComputedStyle(view.getContainer());
  for (const line of lines) {
    L.polyline(line.points.map(latLng),{color:palette.getPropertyValue(line.color).trim(),weight:5,opacity:.9,dashArray:line.walk?'4 6':null}).addTo(group);
  }
  if (markers.length > 1 || lines.length) {
    view.fitBounds(group.getBounds(),{paddingTopLeft:[28,90],
      paddingBottomRight:[28,Math.round(view.getSize().y*.62)],maxZoom:16,animate:false});
  } else if (markers.length === 1) {
    view.setView(latLng(markers[0].point),15,{animate:false});
  }
  return () => group.remove();
}
