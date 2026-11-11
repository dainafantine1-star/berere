import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const args=process.argv[2]==='install'?['install','chromium','firefox','webkit']:['test',...process.argv.slice(2)];
const child=spawn(process.execPath,[resolve('node_modules/@playwright/test/cli.js'),...args],{stdio:'inherit',windowsHide:true,env:{...process.env,PLAYWRIGHT_BROWSERS_PATH:resolve('.cache/playwright')}});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});child.on('exit',code=>process.exitCode=code??1);
