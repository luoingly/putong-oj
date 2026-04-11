import type {
  PostCreatePayload,
  PostDetailQueryResult,
  PostListQuery,
  PostListQueryResult,
  PostUpdatePayload,
} from '@putongoj/shared'
import { instanceSafe as instance } from './instance'

export async function findPosts (params: PostListQuery) {
  return instance.get<PostListQueryResult>('/posts', { params })
}
export async function createPost (payload: PostCreatePayload) {
  return instance.post<{ slug: string }>('/posts', payload)
}

export async function getPost (slug: string) {
  return instance.get<PostDetailQueryResult>(`/post/${encodeURIComponent(slug)}`)
}
export async function updatePost (slug: string, payload: PostUpdatePayload) {
  return instance.put<{ slug: string }>(`/post/${encodeURIComponent(slug)}`, payload)
}
export async function deletePost (slug: string) {
  return instance.delete<null>(`/post/${encodeURIComponent(slug)}`)
}
