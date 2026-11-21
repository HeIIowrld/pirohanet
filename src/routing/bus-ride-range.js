// TOPIS selectBusList.do turnPlaceStationId values matched to the local stop catalogs.
import turnStops from './bus-turn-stops.json' with {type:'json'};

const stopRadius = 75;

function coordinateDistance([lon,lat],[otherLon,otherLat]) {
  return 111_200 * Math.hypot((lon-otherLon)*Math.cos((lat+otherLat)*Math.PI/360),lat-otherLat);
}

function stopMatches(stops, id, point) {
  return stops.flatMap(([stopId,lon,lat], index) => {
    if (!Number.isFinite(lon) || !Number.isFinite(lat) ||
        (id != null && String(stopId) !== String(id))) return [];
    const distance = coordinateDistance([lon,lat],point);
    return id != null || distance <= stopRadius ? [{index,distance}] : [];
  });
}

// undefined means that the catalog cannot verify the stop pair,
// null means both stops are known but the ride is invalid or ambiguous.
export function busRideRange(step, stops) {
  if (!stops?.length || !step.seoulBusStopId || !(step.points?.length >= 2)) return undefined;
  const starts = stopMatches(stops,step.seoulBusStopId,step.points[0]);
  const ends = stopMatches(stops,step.seoulBusAlightStopId,step.points.at(-1));
  if (!starts.length || !ends.length) return undefined;

  const turnId = turnStops[step.seoulBusRouteId];
  const turnIndex = turnId == null ? -1 : stops.findIndex(([id]) => String(id) === String(turnId));
  const matches = starts.flatMap(start => ends.flatMap(end => {
    if (end.index <= start.index) return [];
    if (turnIndex >= 0 && start.index <= turnIndex && end.index > turnIndex) return [];
    return [{
      start:start.index, end:end.index, direction:turnIndex < 0 ? null : Number(start.index > turnIndex),
      distance:start.distance+end.distance, nearby:start.distance <= stopRadius && end.distance <= stopRadius,
    }];
  }));
  if (!matches.length) return null;
  const [best, next] = matches.filter(match => match.nearby).sort((a,b) => a.distance-b.distance);
  if (!best) return undefined;
  if (next && next.distance-best.distance < 15) return null;
  return best;
}
