import { sveltekit } from '@sveltejs/kit/vite';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		// Spreads the defaults because setting `exclude` replaces them entirely,
		// which would otherwise put node_modules back in scope.
		exclude: [...configDefaults.exclude, '**/_Old Versions/**']
	}
});
