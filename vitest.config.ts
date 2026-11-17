import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    server: {
      deps: {
        inline: ['docx'],
      },
    },
    exclude: [
      ...configDefaults.exclude,
      'packages/server/src/llm/intentParser.test.ts',
    ],
  },
});

