// 서울교통공사 수도권 노선도: https://data.seoul.go.kr/dataList/OA-22535/L/1/datasetView.do
const railColors = new Map(Object.entries({
  '1호선':'#0052A4', '2호선':'#00A84D', '3호선':'#EF7C1C', '4호선':'#00A5DE',
  '5호선':'#996CAC', '6호선':'#CD7C2F', '7호선':'#747F00', '8호선':'#E6186C',
  '9호선':'#BDB092', '경의중앙선':'#77C4A3', '경춘선':'#0C8E72',
  '수인분당선':'#FABE00', '공항철도':'#0090D2', '신분당선':'#D4003B',
  '경강선':'#003DA5', '서해선':'#8FC31F', '우이신설선':'#B7C452',
  '신림선':'#6789CA', '인천1호선':'#7CA8D5', '인천2호선':'#ED8B00',
  '의정부경전철':'#FDA600', '용인경전철':'#6FB245', '김포골드라인':'#A17800',
  'GTX-A':'#9A6292',
}));

// 서울시 버스 체계: https://news.seoul.go.kr/traffic/archives/1706
const blue = '#386DE8';
const green = '#268B33';
const red = '#D83745';
const yellow = '#D6A000';
const incheonExpress = '#813D9C';
const busColors = new Map(Object.entries({
  간선:blue, 지선:green, 마을:green, 광역:red, 직행:red, 직행좌석:red,
  광역급행:red, 순환:yellow, 일반:green, 일반형:green, 좌석:blue,
  급행간선:incheonExpress,
}));

export function railLineName(name) {
  const line = name.replace(/[\s·ㆍ]/gu,'').replace(/^수도권전철|^서울지하철|^서울(?=[1-9]호선)/u,'')
    .replace(/\(.*\)$|급행$|특급$/u,'');
  const aliases = {
    경의선:'경의중앙선', 중앙선:'경의중앙선', 분당선:'수인분당선', 수인선:'수인분당선',
    공항선:'공항철도', 인천공항철도:'공항철도', 인천국제공항철도:'공항철도', 인천선:'인천1호선',
    인천도시철도1호선:'인천1호선', 인천도시철도2호선:'인천2호선', 서울경전철신림선:'신림선',
    용인에버라인:'용인경전철', 에버라인:'용인경전철', 김포도시철도:'김포골드라인',
    우이신설경전철:'우이신설선', 광역급행철도A노선:'GTX-A', 수도권광역급행철도A선:'GTX-A', GTXA:'GTX-A',
  };
  return aliases[line] ?? line;
}

function seoulBusColor(name) {
  if (/^서울(?:0[245789]|10)$/u.test(name)) return blue;
  if (/^0[12][AB]?$/u.test(name)) return yellow;
  if (/^9\d{3}[AB]?$/.test(name)) return red;
  if (/^(?:N?\d{3}[AB]?(?:[가-힣]+)?|N\d{2})$/u.test(name)) return blue;
  if (/^\d{4}[AB]?$/.test(name)) return green;
  if (/^[가-힣]+\d{2}(?:-\d+)?$/u.test(name)) return green;
}

function incheonBusColor(name) {
  // 인천시 버스 요금표 및 유형별 색상 표.
  // https://www.incheon.go.kr/ml_kr/MLKR030201
  // https://www.incheon.go.kr/traffic/TR060101/view?nttNo=195
  if (/^급행(?:9[1579]|9\d{2}(?:-\d+)?)$|^(?:95|97|99|9\d{2}(?:-\d+)?)$/u.test(name)) return incheonExpress;
  if (/^(?:5\d{2}(?:-\d+)?|[Ee]음\d+|인천[Ee]음\d+|4[1-36]|5[1246]|83|70[12]|1111|2201|440[12]|9701|9901)$/u.test(name)) return green;
  const regional = /^(?:1000|110[01]|1200|130[012]|1400|1500|1601|3000|6770|6777(?:-1)?|890[12]|9100|920[01]|9300|950[01]|9802)$/;
  if (regional.test(name)) return red;
  if (/^(?:[1-9]|[1-8]\d|9[0-3]|103|111-2|112|20[2-6]|221)(?:-\d+)?$/.test(name)) return blue;
}

function busColor(step) {
  const vehicle = step.vehicles?.[0];
  const observation = step.busComfort?.name === vehicle?.name ? step.busComfort : null;
  const type = (vehicle?.type || observation?.type || '').replace(/\s/gu,'').replace(/(?:형)?버스$|형$/u,'');
  const id = step.seoulBusRouteId ?? '';
  const incheon = /^(?:16\d|170)\d{6}$/.test(id);
  const gyeonggi = /^2\d{8}$/.test(id);
  if (incheon && type === '순환') return green;
  if (gyeonggi && type === '마을') return yellow;
  if (busColors.has(type)) return busColors.get(type);
  const name = (vehicle?.name ?? '').replace(/\([^)]*\)|\s|번$/gu,'').toUpperCase();
  if (/^M\d{4}(?:[가-힣]+)?$/u.test(name)) return red;
  const knownColor = incheon ? incheonBusColor(name.replace(/(\d)인천$/u,'$1'))
    : /^1[0-2]\d{7}$/.test(id) ? seoulBusColor(name) : undefined;
  return knownColor ?? '#327B88';
}

export function routeColor(step) {
  switch (step.type) {
    case 'WALKING': return '#666E78';
    case 'BUS': return busColor(step);
    case 'SUBWAY': return railColors.get(railLineName(step.vehicles?.[0]?.name ?? '')) ?? '#346883';
    default: return '#61676F';
  }
}
