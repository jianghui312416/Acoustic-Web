import { createRouter, createWebHashHistory } from 'vue-router'
import { authState, isAdmin, restoreSession } from '@/modules/auth/authStore.js'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/register',
    name: 'register',
    component: () => import('@/views/RegisterView.vue'),
    meta: { public: true, title: '注册' },
  },
  {
    path: '/',
    name: 'workspace',
    component: () => import('@/views/WorkspaceView.vue'),
    meta: { requiresAuth: true, title: '海洋声场分析' },
  },
  {
    path: '/profile',
    name: 'profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { requiresAuth: true, title: '个人中心' },
  },
  {
    path: '/admin/users',
    name: 'admin-users',
    component: () => import('@/views/AdminUsersView.vue'),
    meta: { requiresAuth: true, requiresAdmin: true, title: '用户审核' },
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to) => {
  await restoreSession()

  if (to.meta.requiresAuth && !authState.token) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (to.meta.requiresAdmin && !isAdmin.value) {
    return { path: '/' }
  }
  if (to.meta.public && authState.token) {
    return { path: '/' }
  }
  return true
})

router.afterEach((to) => {
  const title = to.meta?.title
  document.title = 'Acoustic Geovis'
})
