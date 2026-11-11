import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({plugins:[react(),tailwindcss()],server:{proxy:{'/api':{target:'http://127.0.0.1:3000',headers:{origin:'http://127.0.0.1:3000'}},'/uploads':'http://127.0.0.1:3000','/admin':'http://127.0.0.1:3000'}},build:{outDir:'dist',emptyOutDir:true}});
