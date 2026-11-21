export function designRoutes(trip,stay=10){
 const arrival=n=>new Date(+trip.departAt+n*60000);
 const steps=[{type:'walk',title:'성수역까지 걸어가요',description:'도보 4분'},{type:'ride2',title:'2호선 외선순환',description:'성수역에서 을지로4가'},{type:'transfer',title:'을지로4가에서 환승',description:'5호선으로 갈아타요'},{type:'ride5',title:'5호선',description:'을지로4가에서 광화문'},{type:'arrive',title:'광화문 도착',description:arrival(35).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false})}];
 const direct=[{id:'design-fast',label:'빠른 길',travelMinutes:35,walkMinutes:8,transfers:1,stayMinutes:0,arrivalAt:arrival(35),steps},{id:'design-comfort',label:'편한 길',travelMinutes:41,walkMinutes:5,transfers:0,stayMinutes:0,arrivalAt:arrival(41),steps}];
 const stops=[{id:'design-stop',travelMinutes:40,stayMinutes:stay,extraTravelMinutes:5,arrivalAt:arrival(40+stay),place:{name:'열린책방',subtitle:'서점',detourDistance:'경로에서 250m'},steps:[...steps.slice(0,4),{type:'place',title:'열린책방',description:`${stay}분 머무르기`},steps.at(-1)]}];
 return {all:[...direct,...stops],eligible:[...direct,...stops],direct,stops};
}
