import type { RouteRecordRaw } from 'vue-router'

import Post from '@/views/Post/Post.vue'
import PostInfo from '@/views/Post/PostInfo.vue'

const PostCreate = () => import('@/views/Post/PostCreate.vue')
const PostEdit = () => import('@/views/Post/PostEdit.vue')

const postRoutes: Array<RouteRecordRaw> = [
  {
    // `/post/create` must be placed before `/post/:slug`
    path: '/post/create',
    name: 'postCreate',
    component: PostCreate,
    meta: { title: 'Admin', requiresAdmin: true },
  },
  {
    path: '/post/:slug',
    component: Post,
    children: [
      {
        path: '',
        name: 'postInfo',
        component: PostInfo,
        meta: { title: 'Post' },
      },
      {
        path: 'edit',
        name: 'postEdit',
        component: PostEdit,
        meta: { title: 'Admin', requiresAdmin: true },
      },
    ],
  },
]

export default postRoutes
