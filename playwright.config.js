import {defineConfig,devices} from '@playwright/test';
import {resolve} from 'node:path';
process.env.PLAYWRIGHT_BROWSERS_PATH||=resolve('.cache/playwright');
export default defineConfig({testDir:'./e2e',testMatch:'shop.spec.js',workers:1,fullyParallel:false,timeout:120000,expect:{timeout:15000},reporter:'list',use:{trace:'retain-on-failure',screenshot:'only-on-failure',actionTimeout:15000},projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'celular',use:{...devices['Pixel 7']}}]});
