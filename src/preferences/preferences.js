export function createPreferences({
  fatigueLevel = null,
  priority = null,
  maxExtraTravelMinutes = null,
  savedStop = null,
} = {}) {
  return { fatigueLevel, priority, maxExtraTravelMinutes, savedStop };
}
