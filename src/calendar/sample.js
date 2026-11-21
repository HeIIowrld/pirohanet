// 캘린더 연동이 막혔을 때 쓰는 시연용 일정. Google Calendar events.list의 items와 같은 형식.
// 시나리오: 금요일 18시, 19시 광화문 약속. summarize(SAMPLE_EVENTS, SAMPLE_NOW)로 쓴다.
export const SAMPLE_NOW = new Date('2026-11-20T18:00:00+09:00');

const at = (hhmm) => ({ dateTime: `2026-11-20T${hhmm}:00+09:00` });

export const SAMPLE_EVENTS = [
  { summary: '월급날', start: { date: '2026-11-20' }, end: { date: '2026-11-21' } },
  { summary: '주간 회의', start: at('10:00'), end: at('11:00') },
  { summary: '기획 리뷰', start: at('11:00'), end: at('12:30') },
  { summary: '점심 미팅', location: '여의도', start: at('12:40'), end: at('14:00') },
  { summary: '개발 스프린트', start: at('14:10'), end: at('17:30') },
  { summary: '저녁 약속', location: '교보문고 광화문점', start: at('19:00'), end: at('21:00') },
];
