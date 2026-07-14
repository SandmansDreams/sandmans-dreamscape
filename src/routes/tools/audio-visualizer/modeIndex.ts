// modeIndex.ts
import type { VisualizerMode } from './visualizerHelpers';

const modules = import.meta.glob<{ default?: VisualizerMode }>('./modes/*.ts', { eager: true });

const modes: VisualizerMode[] = [];

for (const path in modules) {
  const mod = modules[path];
  if (!('default' in mod)) continue; // no default export — not a mode file, nothing to warn about

  const exported = mod.default;
  const isValid =
    exported &&
    typeof exported.id === 'string' &&
    typeof exported.draw === 'function' &&
    Array.isArray(exported.settings);

  if (isValid) {
    modes.push(exported as VisualizerMode);
  } else {
    console.warn(`[modes] Skipping ${path} — has a default export but it isn't a valid VisualizerMode`);
  }
}

export default modes;