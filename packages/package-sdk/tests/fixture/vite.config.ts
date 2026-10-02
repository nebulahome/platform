import { defineConfig } from 'vite';

import { nebula } from '../../src/vite/plugin.js';

export default defineConfig({ plugins: [nebula()] });
