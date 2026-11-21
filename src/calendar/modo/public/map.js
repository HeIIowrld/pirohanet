const area = { west: 126.970, east: 126.985, north: 37.5755, south: 37.562 };
const sampleLabels = [
  ['경희궁', 126.9716, 37.5730], ['광화문광장', 126.9762, 37.5731],
  ['정동', 126.9722, 37.5667], ['덕수궁', 126.9755, 37.5646],
  ['청계천', 126.9821, 37.5691], ['무교동', 126.9811, 37.5673]
];

function world([longitude, latitude]) {
  const lat = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
  return [(longitude + 180) / 360, (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2];
}

export function createMap(canvas) {
  const ctx = canvas.getContext('2d');
  const tiles = new Map();
  const defaultCenter = world([126.9774, 37.5693]);
  let center = defaultCenter;
  let scale = 2 ** 24;
  let size = [0, 0];
  let data;
  let drag;
  let mode = 'demo';
  let label = { origin: '서울시청', destination: '광화문역' };
  let selected;
  let animated = false;

  function project(point) {
    const [x, y] = world(point);
    return [(x - center[0]) * scale + size[0] / 2, (y - center[1]) * scale + size[1] / 2];
  }

  function path(points, stroke, width, dash = [], fill = null) {
    ctx.beginPath();
    points.forEach((point, index) => {
      const [x, y] = project(point);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    if (fill) {
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (width) {
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = stroke;
      ctx.setLineDash(dash);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function schematic() {
    const { west, east, north, south } = area;
    const mapPoint = (x, y) => [west + (east - west) * x, north - (north - south) * y];
    const line = (points, stroke, width, fill) => path(points.map(([x, y]) => mapPoint(x, y)), stroke, width, [], fill);
    line([[0,.08],[.28,.07],[.31,.23],[.21,.33],[0,.29]], '', 0, '#d9e7d8');
    line([[.04,.61],[.24,.61],[.34,.77],[.26,.94],[0,.91]], '', 0, '#deeadc');
    line([[.70,.04],[.87,.02],[.94,.14],[.91,.27],[.72,.23]], '', 0, '#e0eadc');
    line([[.59,.62],[.96,.57],[1,.7],[.99,.86],[.72,.87]], '', 0, '#e8ece5');
    for (let i = 0; i < 22; i += 1) {
      for (let j = 0; j < 15; j += 1) {
        const n = (i * 31 + j * 17) % 19;
        const x = i * .055 - .1 + (j % 4) * .007;
        const y = j * .078 - .06 - i * .002 + n * .0006;
        if ((j < 4 && i < 7) || (j > 9 && i < 6) || (i > 14 && j < 4)) continue;
        line([[x,y],[x+.025,y-.003],[x+.030,y+.028],[x+.006,y+.035]], '#e1e3da', 1, n < 7 ? '#e7e9e0' : '#e9eae3');
      }
    }
    for (let i = -2; i < 20; i += 1) {
      const x = i * .07;
      const points = [[x+.08,0],[x+.035,.24],[x+.045,.39],[x-.025,.67],[x-.005,1]];
      line(points, '#e0e1d8', i % 3 ? 7 : 12);
      line(points, '#fbfbf7', i % 3 ? 5 : 9);
    }
    for (let i = 0; i < 14; i += 1) {
      const y = i * .082;
      const points = [[0,y+.05],[.26,y+.01],[.49,y+.039],[.72,y-.013],[1,y+.01]];
      line(points, '#e1e3da', i % 3 ? 6 : 11);
      line(points, '#fcfcf9', i % 3 ? 4 : 8);
    }
    line([[.42,.48],[.53,.47],[.61,.48],[.75,.48],[.88,.50],[1,.47]], '#f8fcfd', 10);
    line([[.42,.48],[.53,.47],[.61,.48],[.75,.48],[.88,.50],[1,.47]], '#a9d3df', 6);
    ctx.textAlign = 'center';
    ctx.font = '600 12px "Malgun Gothic", sans-serif';
    ctx.fillStyle = '#576a68';
    for (const [text, longitude, latitude] of sampleLabels) ctx.fillText(text, ...project([longitude, latitude]));
  }

  function backgroundTiles() {
    const level = Math.max(2, Math.min(19, Math.round(Math.log2(scale / 256))));
    const count = 2 ** level;
    const px = scale / count;
    const left = center[0] * count - size[0] / (px * 2);
    const top = center[1] * count - size[1] / (px * 2);
    for (let x = Math.floor(left); x < left + size[0] / px; x += 1) {
      for (let y = Math.max(0, Math.floor(top)); y < Math.min(count, top + size[1] / px); y += 1) {
        const name = `${level}/${(x % count + count) % count}/${y}`;
        if (!tiles.has(name)) {
          const tile = new Image();
          tile.onload = () => requestAnimationFrame(draw);
          tile.src = `https://tile.openstreetmap.org/${name}.png`;
          tiles.set(name, tile);
          if (tiles.size > 120) tiles.delete(tiles.keys().next().value);
        }
        const tile = tiles.get(name);
        if (tile.complete && tile.naturalWidth) ctx.drawImage(tile, (x - left) * px, (y - top) * px, px + .5, px + .5);
      }
    }
  }

  function pin(coordinate, name, color, shift = -15) {
    const [x, y] = project(coordinate);
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.font = '700 12px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const text = name.length > 18 ? `${name.slice(0, 17)}…` : name;
    const width = ctx.measureText(text).width + 16;
    const px = Math.max(width / 2 + 4, Math.min(size[0] - width / 2 - 4, x));
    const py = y + shift - 6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(px - width / 2, py - 10, width, 21, 6);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillText(text, px, py);
    ctx.textBaseline = 'alphabetic';
  }

  function draw() {
    if (!size[0]) return;
    ctx.fillStyle = '#edf0e9';
    ctx.fillRect(0, 0, ...size);
    if (mode === 'demo') schematic();
    else if (data) backgroundTiles();
    if (!data) return;
    const { baseline, recommended } = data;
    const drawRoute = (route, active) => {
      const ordinary = route.id === baseline.id;
      path(route.coordinates, '#ffffff', active ? 11 : 6);
      path(route.coordinates, ordinary ? '#526a94' : '#244dbd', active ? 6 : 3.5, ordinary ? [5, 6] : []);
    };
    if (selected.id !== baseline.id) drawRoute(baseline, false);
    else if (recommended.id !== baseline.id) drawRoute(recommended, false);
    drawRoute(selected, true);
    const coords = baseline.coordinates;
    pin(coords[0], label.origin, '#244dbd', 24);
    pin(coords.at(-1), label.destination, '#26765e');
    if (selected.place) pin(selected.place.coordinate, selected.place.name, '#9b4c27', -17);
  }

  function fit() {
    if (!size[0]) return;
    if (!data) {
      center = defaultCenter;
      scale = Math.min(size[0] * 47, size[1] * 78) * 1050;
      draw();
      return;
    }
    const all = [...data.baseline.coordinates, ...selected.coordinates, ...data.recommended.coordinates].map(world);
    const bounds = all.reduce(([left, top, right, bottom], [x, y]) => [
      Math.min(left, x), Math.min(top, y), Math.max(right, x), Math.max(bottom, y)
    ], [Infinity, Infinity, -Infinity, -Infinity]);
    const [left, top, right, bottom] = bounds;
    center = [(left + right) / 2, (top + bottom) / 2];
    const padding = size[0] < 500 ? 112 : 170;
    scale = Math.max(2 ** 11, Math.min(2 ** 27, (size[0] - padding) / Math.max(right - left, 1e-8), (size[1] - 106) / Math.max(bottom - top, 1e-8)));
    draw();
  }

  const observer = new ResizeObserver(() => {
    size = [canvas.clientWidth, canvas.clientHeight];
    const dpi = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size[0] * dpi);
    canvas.height = Math.round(size[1] * dpi);
    ctx.setTransform(dpi, 0, 0, dpi, 0, 0);
    fit();
  });
  observer.observe(canvas);

  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = [event.clientX, event.clientY, ...center];
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag) return;
    center = [drag[2] - (event.clientX - drag[0]) / scale, drag[3] - (event.clientY - drag[1]) / scale];
    draw();
  });
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
    canvas.classList.remove('dragging');
  });

  return {
    clear(nextMode) { data = null; mode = nextMode; fit(); },
    show(result, trip, route) {
      data = result; label = trip; mode = result.mode; selected = route; fit();
      if (!animated && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
        canvas.animate([{ opacity: .65 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
      }
      animated = true;
    },
    select(route) { selected = route; fit(); },
    zoom(amount) { scale = Math.max(2 ** 11, Math.min(2 ** 27, scale * amount)); draw(); },
    reset: fit
  };
}
