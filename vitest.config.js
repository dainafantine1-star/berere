import {defineConfig} from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],test:{pool:'vmThreads',environment:'jsdom',globals:true,testTimeout:15000,maxWorkers:1,fileParallelism:false,setupFiles:['./src/test-setup.js'],include:['src/**/*.test.{js,jsx}']}});
