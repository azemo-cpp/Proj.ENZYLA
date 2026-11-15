declare module 'vite' {
  export function defineConfig(config: any): any;
}

declare module '@vitejs/plugin-react' {
  export default function react(): any;
}

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-ignore: plain JS plugin, walang type declarations
import daryl from './daryl/vite-plugin.js';

export default defineConfig({
  plugins: [react(), daryl()],
  // Sumusulat si Daryl ng sarili niyang mga file habang tumatakbo. Huwag itong gawing dahilan para mag-reload ang page.
  server: { watch: { ignored: ['**/daryl/**'] } },
});

