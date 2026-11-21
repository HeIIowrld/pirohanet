import React,{useState} from 'react';
import questions from './onboarding-questions.json';
import {Actions,Art,Button} from './design.jsx';
export default function Onboarding({initial,onComplete}) {
 const [step,setStep]=useState('intro'),[answers,setAnswers]=useState({...initial,priority:null,maxExtraTravelMinutes:10});
 const update=(key,value)=>setAnswers(a=>({...a,[key]:value}));
 const [route,extra,arrival,stairs]=questions.questions;
 const choices=(question,key)=> <div className="onboarding-options" role="radiogroup" aria-label={question.title||questions.title}>{question.options.map(option=><button type="button" className={`onboarding-option ${answers[key]===option.value?'selected':''}`} key={String(option.value)} role="radio" aria-checked={answers[key]===option.value} onClick={()=>update(key,option.value)}><span>{option.label}</span><img src={`/assets/figma/radio-${answers[key]===option.value?'selected':'empty'}.svg`} width="24" height="24" alt=""/></button>)}</div>;
 return <section className={`onboarding onboarding-${step}`} key={step} aria-label="처음 이동 선호 설정" data-design-node={step==='intro'?'55:1408':step==='route'?'54:1336':step==='arrival'?'57:1418':'57:1472'}>
 {step==='intro'?<><Art name="route-preference"/><h1>{questions.intro.title}</h1><p className="onboarding-description">{questions.intro.description.map((line,i)=><React.Fragment key={line}>{i>0&&<br/>}{line}</React.Fragment>)}</p></>:<div className="onboarding-content"><h1>{step==='route'?questions.title:step==='arrival'?arrival.title:stairs.title}</h1>{step==='route'?<>{choices(route,'priority')}{answers.priority&&answers.priority!=='fastest'&&<div className="onboarding-extra"><h2>{extra.title}</h2><div className="chips" role="radiogroup" aria-label={extra.title}>{extra.options.map(o=><button key={o.value} type="button" role="radio" aria-checked={answers.maxExtraTravelMinutes===o.value} className={answers.maxExtraTravelMinutes===o.value?'selected':''} onClick={()=>update('maxExtraTravelMinutes',o.value)}>{o.label}</button>)}</div></div>}</>:step==='arrival'?choices(arrival,'arrivalBufferMinutes'):choices(stairs,'avoidStairs')}</div>}
 <Actions><Button disabled={step==='route'&&!answers.priority} onClick={()=>step==='intro'?setStep('route'):step==='route'?setStep('arrival'):step==='arrival'?setStep('stairs'):onComplete(answers)}>{step==='stairs'?questions.actions.complete:questions.actions.next}</Button><Button kind="text" onClick={()=>onComplete(null)}>{questions.actions.skip}</Button></Actions>
 </section>
}
