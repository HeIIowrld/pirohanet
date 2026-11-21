export const demo = {
  origin: '서울시청',
  destination: '교보문고 광화문점',
  departAt: '2026-11-20T18:00:00+09:00',
  arriveBy: '2026-11-20T19:00:00+09:00',
  places: [
    { id: 'history', name: '서울시립미술관', category: '전시' },
    { id: 'coffee', name: '정동길 카페', category: '카페' },
    { id: 'culture', name: '서울역사박물관', category: '전시' }
  ]
};

const at = time => ({ dateTime: `2026-11-20T${time}:00+09:00` });
const event = (summary, start, end, location) => ({ summary, start: at(start), end: at(end), ...(location && { location }) });

export const sampleEvents = [
  { summary: '월급날', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } },
  event('주간 회의', '10:00', '11:00'),
  event('기획 리뷰', '11:00', '12:30'),
  event('점심 미팅', '12:40', '14:00', demo.origin),
  event('개발 스프린트', '14:10', '17:30'),
  event('저녁 약속', '19:00', '21:00', demo.destination)
];
