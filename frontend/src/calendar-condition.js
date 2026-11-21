import { LABELS, summarize } from '../../src/calendar/calendar.js';

const fatigueReasons = {
  physical_activity: '몸을 쓰는 활동',
  prolonged_standing: '오래 서 있는 일정',
};
const mobilityLabels = {
  footwear: '오래 걷기 불편한 신발',
  luggage: '이동이 불편한 짐',
  footwear_and_luggage: '오래 걷기 불편한 신발과 짐',
};

export async function calendarCondition(token, horizon, destinationEventId) {
  try {
    const response = await fetch('/api/calendar-condition', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ horizon: +horizon, destinationEventId }),
      signal: AbortSignal.timeout(4000),
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function tripCondition(events, now, horizon, manualLevel, inference) {
  const { fatigue } = summarize(events, now, manualLevel, +horizon);
  const reason = Object.hasOwn(fatigueReasons, inference?.fatigue_signal)
    ? fatigueReasons[inference.fatigue_signal] : null;
  const mobility = Object.hasOwn(mobilityLabels, inference?.mobility_signal)
    ? inference.mobility_signal : null;
  // 직접 고른 컨디션에도 출발 전까지 남은 일정 부담을 더한다(최대 5). summarize가 그 값을 fatigue.level로 돌려준다.
  const level = manualLevel !== null
    ? fatigue?.level ?? manualLevel
    : reason ? Math.min(5, (fatigue?.level ?? 1) + 1) : fatigue?.level ?? null;
  return {
    level,
    label: LABELS[level - 1],
    source: manualLevel !== null ? (level > manualLevel ? '직접 선택한 컨디션 + 출발 전 남은 일정' : '직접 선택한 컨디션') : reason ? '일정 내용 기반 예상 컨디션' : '일정 시간 기반 예상 컨디션',
    reason: manualLevel === null ? reason ?? fatigue?.reasons[0] : null,
    mobility,
    mobilityLabel: mobilityLabels[mobility],
  };
}
