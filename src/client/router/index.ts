import { createRouter, createWebHistory } from 'vue-router';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'library', component: () => import('@/pages/LibraryPage.vue') },
    { path: '/books', name: 'books', component: () => import('@/pages/BooksPage.vue') },
    { path: '/books/:id', name: 'book-detail', component: () => import('@/pages/BookDetailPage.vue') },
    { path: '/reader/:bookId/:chapterIndex', name: 'reader', component: () => import('@/pages/ReaderPage.vue') },
    { path: '/search', name: 'search', component: () => import('@/pages/SearchPage.vue') },
    { path: '/online', name: 'online', component: () => import('@/pages/OnlinePage.vue') },
    { path: '/sources', name: 'sources', component: () => import('@/pages/SourcesPage.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue') },
  ],
  scrollBehavior() {
    return { top: 0 };
  },
});