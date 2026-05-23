import type { Preview } from '@storybook/nextjs-vite';

// Pull Tailwind v4 (`@import 'tailwindcss'`) plus the design-token CSS
// variables into every story preview. Without this, RunProgress.stories.tsx
// would render unstyled because Storybook never touches `src/app/layout.tsx`.
import '../src/app/globals.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: 'todo',
    },
  },
};

export default preview;
