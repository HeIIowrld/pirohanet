import { placeAliasKey } from '../preferences/place-alias.js';

export function planDepartureReminder(trip, route) {
  const appointment = trip.calendar.nextAppointment;
  if (!appointment || placeAliasKey(trip.destination) !== placeAliasKey(appointment.location) ||
      !trip.arriveBy || !Number.isFinite(route?.travelMinutes) || route.travelMinutes <= 0) return null;

  const startsAt = Date.parse(appointment.start);
  const arriveBy = Math.min(+trip.arriveBy, startsAt);
  if (!Number.isFinite(arriveBy)) return null;
  const travelMinutes = Math.ceil(route.travelMinutes);
  return {
    key: JSON.stringify([startsAt, appointment.location, appointment.title]),
    title: appointment.title || '다음 일정',
    location: appointment.location,
    startsAt,
    travelMinutes,
    leaveAt: arriveBy - travelMinutes * 60_000,
    mapUrl: route.links?.[0]?.url,
  };
}

export function createDepartureReminder(timeFormat) {
  const card = document.querySelector('#departure-card');
  const status = document.querySelector('#departure-status');
  const announcement = document.querySelector('#departure-announcement');
  const heading = card.querySelector('h2');
  const label = card.querySelector('#departure-label');
  const appointment = card.querySelector('#departure-appointment');
  const location = card.querySelector('#departure-location');
  const timing = card.querySelector('#departure-timing');
  const action = card.querySelector('.departure-action');
  const close = card.querySelector('.departure-close');
  const dismissed = new Set();
  let plan = null;
  let timer;
  let previewButton = null;

  function hide() {
    card.hidden = true;
    announcement.textContent = '';
    previewButton = null;
  }

  function show(reminder, now, preview = false) {
    const late = now - reminder.leaveAt >= 60_000;
    label.textContent = preview ? '출발 알림 미리보기' : '출발 알림';
    heading.textContent = late ? '지금 출발해도 도착 목표를 넘길 수 있어요' : '지금 출발할 시간이에요';
    appointment.textContent = `${timeFormat.format(reminder.startsAt)} · ${reminder.title}`;
    location.textContent = reminder.location;
    timing.textContent = `권장 출발 ${timeFormat.format(reminder.leaveAt)} · 이동 약 ${reminder.travelMinutes}분`;
    action.href = preview ? '#check-places' : reminder.mapUrl || '#results-heading';
    action.target = !preview && reminder.mapUrl ? '_blank' : '_self';
    action.textContent = preview ? '경로 찾기로 이동' : reminder.mapUrl ? '카카오맵에서 길찾기' : '경로 보기';
    card.hidden = false;
    if (!preview) announcement.textContent = `${label.textContent}. ${heading.textContent}. ${appointment.textContent}. ${reminder.location}.`;
  }

  function check() {
    clearTimeout(timer);
    if (!plan || document.hidden) return;

    const now = Date.now();
    if (now >= plan.startsAt) {
      set(null);
      return;
    }

    const acknowledged = dismissed.has(plan.key);
    if (now >= plan.leaveAt && !acknowledged && card.hidden) {
      status.textContent = '출발 알림 · 출발할 시간이에요.';
      show(plan, now);
    }
    const next = now < plan.leaveAt && !acknowledged ? plan.leaveAt : plan.startsAt;
    timer = setTimeout(check, Math.min(next - now, 2_147_483_647));
  }

  function set(reminder) {
    hide();
    plan = reminder;
    status.hidden = !plan;
    status.textContent = plan ? (dismissed.has(plan.key) ? '출발 알림 · 확인 완료' :
      `출발 알림 · ${timeFormat.format(plan.leaveAt)} 예정`) : '';
    check();
  }

  function dismiss(focusTarget) {
    if (!previewButton && plan) {
      dismissed.add(plan.key);
      status.textContent = '출발 알림 · 확인 완료';
      check();
    }
    hide();
    focusTarget.focus();
  }

  close.addEventListener('click', () => dismiss(previewButton || status));
  action.addEventListener('click', () => {
    const fragment = action.getAttribute('href');
    dismiss(fragment.startsWith('#') ? document.querySelector(fragment) : status);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss(previewButton || status);
  });
  document.addEventListener('visibilitychange', check);

  return {
    set,
    preview(reminder, trigger) {
      previewButton = trigger;
      show(reminder, reminder.leaveAt, true);
      card.focus();
    },
  };
}
