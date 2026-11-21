import React, {useLayoutEffect, useRef, useEffect} from 'react';
const ROW=44;
export default function TimeWheel({label,items,value,onChange}) {
 const ref=useRef(null), timer=useRef(null), initial=useRef(value);
 useLayoutEffect(()=>{ref.current.scrollTop=Math.max(0,items.indexOf(initial.current))*ROW},[]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const select=(index)=>{const next=Math.max(0,Math.min(items.length-1,index));onChange(items[next]);ref.current.scrollTo({top:next*ROW,behavior:'smooth'})};
 return <div ref={ref} className="wheel" role="listbox" aria-label={label} tabIndex={0}
  onScroll={()=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{const index=Math.max(0,Math.min(items.length-1,Math.round(ref.current.scrollTop/ROW)));onChange(items[index])},120)}}
  onKeyDown={e=>{const index=items.indexOf(value);const next={ArrowDown:index+1,ArrowUp:index-1,Home:0,End:items.length-1}[e.key];if(next!==undefined){e.preventDefault();select(next)}}}>
  {items.map((item,index)=><button type="button" key={item} role="option" aria-selected={value===item} tabIndex={-1} className={value===item?'chosen':''} onClick={()=>select(index)}>{item}</button>)}
 </div>
}
