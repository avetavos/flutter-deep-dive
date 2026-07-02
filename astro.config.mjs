// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

import preact from '@astrojs/preact';

// https://astro.build/config
export default defineConfig({
  // GitHub Pages project site. Update `site` to your GitHub username and `base`
  // to your repo name if they differ.
  site: 'https://deep-dive.avetavos.com',
  base: '/flutter',
  output: 'static',
  integrations: [starlight({
      title: 'Flutter Deep Dive',
      head: [
        { tag: 'script', attrs: { type: 'module', src: '/flutter/enhance.js' } },
        { tag: 'link', attrs: { rel: 'manifest', href: '/flutter/manifest.webmanifest' } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: '/flutter/apple-touch-icon.png' } },
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/flutter/icon-192.png' } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#027DFD' } },
        { tag: 'meta', attrs: { name: 'mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-capable', content: 'yes' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' } },
        { tag: 'meta', attrs: { name: 'apple-mobile-web-app-title', content: "Flutter Deep Dive" } },
        { tag: 'script', content: "if('serviceWorker' in navigator){window.addEventListener('load',function(){navigator.serviceWorker.register('/flutter/sw.js',{scope:'/flutter/'}).catch(function(){})})}" },
      ],
      defaultLocale: 'en',
      locales: {
        en: { label: 'English', lang: 'en' },
        th: { label: 'ไทย', lang: 'th' },
      },
      customCss: ['./src/styles/custom.css'],
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/avetavos/flutter-deep-dive' }],
      sidebar: [
        { label: 'Dart Foundations', items: [{ autogenerate: { directory: 'dart-foundations' } }] },
        { label: 'Everything Is a Widget', items: [{ autogenerate: { directory: 'widgets' } }] },
        { label: 'Layout & Rendering', items: [{ autogenerate: { directory: 'layout-and-rendering' } }] },
        { label: 'State Management', items: [{ autogenerate: { directory: 'state-management' } }] },
        { label: 'Navigation & App Structure', items: [{ autogenerate: { directory: 'navigation' } }] },
        { label: 'Async, Performance & Rendering', items: [{ autogenerate: { directory: 'async-and-performance' } }] },
        { label: 'Tooling, Testing & Production', items: [{ autogenerate: { directory: 'tooling-and-production' } }] },
      ],
      }), preact()],
});
