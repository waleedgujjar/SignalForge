import eslint from '@signalforge/eslint-config/base';

export default [
  ...eslint,
  {
    ignores: ['next-env.d.ts'],
  },
];
