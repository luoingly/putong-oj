import type { PostModel } from '@putongoj/shared'
import type { AppContext } from '../types/koa'
import type { WithId } from '../types'
import Post from '../models/Post'

export interface PostState {
  post: WithId<PostModel>
}

function buildPostState (c: AppContext, post: WithId<PostModel>) {
  const state: PostState = { post }
  c.set('post', state)
  return state
}

export async function loadPost (c: AppContext, inputSlug?: string) {
  const slug = String(inputSlug ?? c.req.param('slug'))
  if (slug.length === 0) {
    return null
  }
  if (c.get('post')?.post.slug === slug) {
    return c.get('post')!
  }

  const post = await Post.findOne({ slug }).lean()
  if (!post) {
    return null
  }

  const isAdmin = c.get('profile')?.isAdmin ?? false
  if (!post.isPublished && !isAdmin) {
    return null
  }

  return buildPostState(c, post)
}
