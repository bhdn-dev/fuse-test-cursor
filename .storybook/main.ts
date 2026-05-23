import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],
  addons: [
    '@chromatic-com/storybook',
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
    '@storybook/addon-mcp',
  ],
  framework: '@storybook/nextjs-vite',
  staticDirs: ['../public'],
  // Forward `/api/*` from the Storybook dev server (port 6006) to the Next.js
  // dev server (port 3000) so the "Live" story in
  // `src/components/RunProgress/RunProgress.stories.tsx` can talk to the real
  // SSE endpoint at `/api/run` without cross-origin headaches.
  //
  // Requires `npm run dev` to be running alongside `npm run storybook`.
  // SSE-friendly: `ws: false` is fine — http-proxy streams chunked responses
  // out of the box, which is what `text/event-stream` needs.
  async viteFinal(config) {
    const { mergeConfig } = await import('vite');
    return mergeConfig(config, {
      server: {
        proxy: {
          '/api': {
            target: 'http://localhost:3000',
            changeOrigin: true,
          },
        },
      },
    });
  },
};
export default config;
