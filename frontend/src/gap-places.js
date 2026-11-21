import {searchPlaces} from '../../src/calendar/location.js';
import {loadRecommendedStops,resolveRecommendedStop} from '../../src/places/recommended-stops.js';

const WALKING_RADIUS = 800;
const PLACE_LIMIT = 2;

function distance(a,b) {
  const latitude = (a.latitude+b.latitude)*Math.PI/360;
  return 111_200 * Math.hypot(a.latitude-b.latitude,(a.longitude-b.longitude)*Math.cos(latitude));
}

export function routeMiddle(route) {
  const segments = [];
  let length = 0;
  for (const step of route?.steps ?? []) {
    const points = (step.points ?? []).filter(point => point?.length === 2 && point.every(Number.isFinite))
      .map(([longitude,latitude]) => ({longitude,latitude}));
    for (let i=1;i<points.length;i++) {
      const from=points[i-1], to=points[i];
      const meters=distance(from,to);
      if (meters <= 0) continue;
      segments.push({from,to,meters,start:length});
      length+=meters;
    }
  }
  if (!length) return null;
  const segment=segments.find(part => part.start+part.meters>=length/2);
  const fraction=(length/2-segment.start)/segment.meters;
  return {
    latitude:segment.from.latitude+(segment.to.latitude-segment.from.latitude)*fraction,
    longitude:segment.from.longitude+(segment.to.longitude-segment.from.longitude)*fraction,
  };
}

async function searchArea(anchor, fetchFn) {
  const station=anchor.name?.match(/^(.+?역)(?:\s|$)/)?.[1];
  if (station && station.length < 25) return station;
  const {latitude,longitude}=anchor;
  const response=await fetchFn(`/api/reverse-geocode?${new URLSearchParams({latitude,longitude})}`);
  if (!response.ok) return '';
  const {documents}=await response.json();
  const address=documents?.[0]?.address;
  return address?.region_3depth_name
    ? [address.region_1depth_name,address.region_2depth_name,address.region_3depth_name].filter(Boolean).join(' ')
    : '';
}

export async function gapPlaces(places, route, saved, fetchFn=fetch) {
  const {origin,destination}=places;
  const middle=routeMiddle(route);
  const areas=[['origin',origin],['enRoute',middle],['destination',destination]].filter(([,anchor]) => anchor);
  const nearestArea=place => {
    const nearest=areas.reduce((best, area) => distance(place,area[1]) < distance(place,best[1]) ? area : best);
    return nearest[0];
  };
  const catalog=await loadRecommendedStops(fetchFn).catch(() => null);
  const candidates=await Promise.all(areas.map(async ([area,anchor]) => {
    const local=place => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
      && distance(place,anchor) <= WALKING_RADIUS && nearestArea(place) === area
      && distance(place,origin)>20 && distance(place,destination)>20;
    const savedNearby=saved.filter(local).sort((a,b) => distance(a,anchor)-distance(b,anchor));
    const district=anchor.address?.match(/(?:^|\s)([^\s]+구)(?:\s|$)/)?.[1];
    const street=anchor.address?.match(/\S+(?:대로|로|길)(?=\s|$)/)?.[0];
    const curated=(catalog?.places ?? []).filter(({location}) =>
      Number.isFinite(location.lat) && Number.isFinite(location.lng)
        ? local({latitude:location.lat,longitude:location.lng})
        : district && district===location.district && street && location.address?.includes(street),
    ).slice(0,1);
    const [discover,named]=await Promise.all([
      searchArea(anchor,fetchFn).then(query => query ? searchPlaces(`${query} 카페`,fetchFn) : []).catch(() => []),
      Promise.all(curated.map(item => resolveRecommendedStop(item,fetchFn).catch(() => null))),
    ]);
    const nearby=[...savedNearby,...named.filter(place => place && local(place)),...discover.filter(local).sort((a,b) => distance(a,anchor)-distance(b,anchor))];
    return nearby.filter((place,index) => !nearby.slice(0,index).some(other => distance(other,place)<15))
      .slice(0,PLACE_LIMIT).map(place => ({...place,area}));
  }));
  return candidates.flat();
}
