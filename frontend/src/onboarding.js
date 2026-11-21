export const DEFAULT_TRAVEL_PREFERENCES=Object.freeze({priority:'fastest',maxExtraTravelMinutes:null,arrivalBufferMinutes:10,avoidStairs:false});
export const onboardingKey=demo=>demo?'modo.onboarding.demo.v1':'modo.onboarding.v1';
const browserStorage=()=>{try{return globalThis.localStorage}catch{return null}};
export function normalizeTravelPreferences(value={}) {
 const priority=['fastest','walking','transfers','crowding'].includes(value?.priority)?value.priority:'fastest';
 return {priority,maxExtraTravelMinutes:priority==='fastest'?null:([5,10,20].includes(value?.maxExtraTravelMinutes)?value.maxExtraTravelMinutes:10),arrivalBufferMinutes:[0,5,10,15].includes(value?.arrivalBufferMinutes)?value.arrivalBufferMinutes:10,avoidStairs:value?.avoidStairs===true};
}
export function readOnboarding(demo=false,storage=browserStorage()) {
 try{const data=JSON.parse(storage?.getItem(onboardingKey(demo))??'null');if(data?.version===1&&data.completed===true)return {completed:true,preferences:normalizeTravelPreferences(data.preferences)}}catch{}
 return {completed:false,preferences:{...DEFAULT_TRAVEL_PREFERENCES}};
}
export function completeOnboarding(preferences,demo=false,storage=browserStorage()) {
 const state={version:1,completed:true,preferences:normalizeTravelPreferences(preferences)};
 try{if(!storage)return false;storage.setItem(onboardingKey(demo),JSON.stringify(state));return true}catch{return false}
}
