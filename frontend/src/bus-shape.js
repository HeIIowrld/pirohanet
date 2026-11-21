const metersPerDegree = 111_200;

export function distanceBetween([x1,y1],[x2,y2]) {
  return metersPerDegree * Math.hypot((x2-x1)*Math.cos((y1+y2)*Math.PI/360),y2-y1);
}

function snap(line, point) {
  let closest = null;
  let along = 0;
  const scale = Math.cos(point[1]*Math.PI/180);
  for (let index = 0; index < line.length-1; index++) {
    const [x,y] = line[index];
    const [tx,ty] = line[index+1];
    const dx = (tx-x)*scale;
    const dy = ty-y;
    const length = Math.hypot(dx,dy)*metersPerDegree;
    if (!length) continue;
    const fraction = Math.min(1,Math.max(0,((point[0]-x)*scale*dx+(point[1]-y)*dy)/(dx*dx+dy*dy)));
    const projected = [x+(tx-x)*fraction,y+dy*fraction];
    const offset = distanceBetween(projected,point);
    if (!closest || offset < closest.offset) {
      closest = {index,point:projected,offset,along:along+length*fraction};
    }
    along += length;
  }
  return closest;
}

export function matchBusShape(step, shapes, options) {
  const name = step.vehicles?.[0]?.name;
  if (!name) return null;
  const ref = name.replace(/([0-9][a-z]?)[가-힣]+$/iu,'$1');
  return clipBusShape(step,shapes?.[name] ?? shapes?.[ref] ?? [],options);
}

export function clipBusShape(step, lines = [], {forwardOnly = false} = {}) {
  const [from,...remainder] = step.points;
  const to = remainder.at(-1);
  const stops = remainder.slice(0,-1);
  const directDistance = distanceBetween(from,to);
  let best = null;
  for (const line of lines) {
    const start = snap(line,from);
    const finish = snap(line,to);
    if (!start || !finish || start.offset > 55 || finish.offset > 55) continue;
    const length = Math.abs(finish.along-start.along);
    if (length < directDistance*.6 || length > directDistance*2.2+150) continue;
    const direction = Math.sign(finish.along-start.along);
    if (!direction || (forwardOnly && direction < 0)) continue;
    let previous = start.along;
    let stopsMatch = true;
    for (const stop of stops) {
      const match = snap(line,stop);
      if (!match || match.offset > 70 || (match.along-previous)*direction < -15 ||
          (finish.along-match.along)*direction < -15) {
        stopsMatch = false;
        break;
      }
      previous = match.along;
    }
    if (!stopsMatch) continue;
    const quality = start.offset+finish.offset+length*.01;
    if (best && best.quality <= quality) continue;
    const [first,last] = direction === 1 ? [start,finish] : [finish,start];
    const clipped = [first.point,...line.slice(first.index+1,last.index+1),last.point];
    if (direction < 0) clipped.reverse();
    best = {quality,points:clipped};
  }
  return best?.points ?? null;
}
