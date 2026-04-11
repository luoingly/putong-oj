import type { RouteRecordRaw } from 'vue-router'

import PostInfo from '@/views/Post/PostInfo.vue'

const PostEdit = () => import('@/views/Post/PostEdit.vue')

const postRoutes: Array<RouteRecordRaw> = [
  {
    path: '/post/:slug',
    name: 'PostDetail',
    component: PostInfo,
    meta: { title: 'Post' },
  },
  {
    path: '/post/:slug/edit',
    name: 'PostEdit',
    component: PostEdit,
    meta: { title: 'Edit Post', requiresAdmin: true },
  },
]

export default postRoutes
