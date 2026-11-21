import { spawn } from 'node:child_process';
const children=[spawn(process.execPath,['dev-server.mjs'],{stdio:'inherit',env:{...process.env,PORT:'5174',APP_ORIGIN:process.env.APP_ORIGIN??'http://localhost:5173',REACT_FRONTEND:'1'}}),spawn(process.execPath,['node_modules/vite/bin/vite.js'],{stdio:'inherit'})];
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill();process.exitCode=code;}
for(const child of children){child.on('error',()=>stop(1));child.on('exit',code=>stop(code??1));}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
