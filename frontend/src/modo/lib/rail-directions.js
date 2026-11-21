import lines from './seoul-rail-order.json' with { type: 'json' };

const renamed = new Map([['당고개', '불암산']]);

export function stationName(value) {
  const name = String(value ?? '').trim().replace(/\([^)]*\)/g, '').replace(/역$/u, '').replace(/\s/g, '');
  return renamed.get(name) ?? name;
}

const networks = new Map(Object.entries(lines).map(([line, branches]) => {
  const stops = new Map();
  const connect = (from, to) => {
    if (!stops.has(from)) stops.set(from, new Set());
    stops.get(from).add(to);
  };
  for (const [branchIndex, branch] of branches.entries()) {
    const names = branch.map(stationName);
    for (let index = 1; index < names.length; index += 1) {
      const [before, after] = [names[index - 1], names[index]];
      connect(before, after);
      if (line !== '6' || branchIndex !== 1) connect(after, before);
    }
  }
  return ['100' + line, stops];
}));

function routesBetween(network, from, to, count, firstStep) {
  if (!network?.has(from) || !network.has(to) || from === to) return [];
  const queue = [[from]];
  const paths = [];
  for (let index = 0; index < queue.length && paths.length < 2; index += 1) {
    const path = queue[index];
    const stop = path.at(-1);
    const length = path.length - 1;
    if (stop === to) {
      if (!count || length === count) paths.push(path);
      continue;
    }
    if (length >= (count || network.size)) continue;
    for (const next of network.get(stop) ?? []) {
      if ((!firstStep || length > 0 || next === firstStep) && !path.includes(next)) queue.push([...path, next]);
    }
  }
  return paths;
}

export function railDirection(line, from, to, count) {
  const network = networks.get(line);
  const paths = routesBetween(network, from, to, count);
  if (paths.length !== 1) return null;
  const [path] = paths;
  return {
    next: path[1],
    canReach(terminal) {
      if (!terminal || !network.has(terminal)) return true;
      if (terminal === to) return true;
      const onward = routesBetween(network, from, terminal, 0, path[1]);
      return onward.some(route => route.includes(to));
    }
  };
}
