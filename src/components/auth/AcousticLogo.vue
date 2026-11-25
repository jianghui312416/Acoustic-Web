<template>
  <svg class="acoustic-logo" viewBox="0 0 96 96" role="img" aria-label="海洋声场分析">
    <defs>
      <linearGradient id="logo-stroke" x1="8" y1="10" x2="88" y2="88" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#b6fbff" />
        <stop offset="0.45" stop-color="#3fe0ff" />
        <stop offset="1" stop-color="#0f9fd6" />
      </linearGradient>
      <radialGradient id="logo-glow" cx="50%" cy="38%" r="62%">
        <stop offset="0" stop-color="#43e7ff" stop-opacity="0.28" />
        <stop offset="1" stop-color="#0a3550" stop-opacity="0" />
      </radialGradient>
      <filter id="logo-soft" x="-40%" y="-40%" width="180%" height="180%">
        <feGaussianBlur stdDeviation="1.6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    <circle cx="48" cy="46" r="42" fill="url(#logo-glow)" />
    <circle cx="48" cy="46" r="32" fill="none" stroke="url(#logo-stroke)" stroke-opacity="0.16" />

    <g fill="none" stroke="url(#logo-stroke)" stroke-linecap="round" filter="url(#logo-soft)">
      <path d="M70 26a31 31 0 0 1 6 18" stroke-width="2.4" stroke-opacity="0.75" />
      <path d="M63 33a19 19 0 0 1 4 11" stroke-width="2" stroke-opacity="0.55" />
      <path d="M56 40a8 8 0 0 1 2 5" stroke-width="1.8" stroke-opacity="0.4" />
      <path d="M18 56c8-9 16-9 24 0s16 9 24 0 12-7 18-2" stroke-width="3.2" />
      <path d="M16 66c9-9 18-9 27 0s17 9 25-1 12-6 18-1" stroke-width="2.6" stroke-opacity="0.72" />
      <path d="M22 75c8-7 15-7 23 0s16 7 23-1" stroke-width="2" stroke-opacity="0.45" />
    </g>

    <circle cx="50" cy="34" r="4.6" fill="#9df7ff" filter="url(#logo-soft)" />
    <circle cx="50" cy="34" r="1.9" fill="#e9ffff" />
  </svg>
</template>

<style scoped>
.acoustic-logo {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
  filter: drop-shadow(0 0 14px rgba(52, 220, 255, 0.35));
}
</style>
