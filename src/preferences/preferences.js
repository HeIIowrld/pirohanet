export function createPreferences({
  fatigueLevel = null,
  priority = null,
  preferredMode = null,
  avoidLine = null,
  maxExtraTravelMinutes = null,
  savedStop = null,
} = {}) {
  return { fatigueLevel, priority, preferredMode, avoidLine, maxExtraTravelMinutes, savedStop };
}
