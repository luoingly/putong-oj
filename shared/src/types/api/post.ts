import { z } from 'zod'
import { PostModelSchema } from '../model/index.js'
import { PaginatedSchema, PaginationSchema } from './utils.js'

export const PostListQuerySchema = z.object({
  page: PaginationSchema.shape.page,
  pageSize: PaginationSchema.shape.pageSize.default(10),
})

export type PostListQuery = z.infer<typeof PostListQuerySchema>

export const PostListQueryResultSchema = PaginatedSchema(z.object({
  slug: PostModelSchema.shape.slug,
  title: PostModelSchema.shape.title,
  isPublished: PostModelSchema.shape.isPublished,
  isPinned: PostModelSchema.shape.isPinned,
  isHidden: PostModelSchema.shape.isHidden,
  createdAt: PostModelSchema.shape.createdAt,
  updatedAt: PostModelSchema.shape.updatedAt,
}))

export type PostListQueryResult = z.input<typeof PostListQueryResultSchema>

export const PostDetailQueryResultSchema = z.object({
  slug: PostModelSchema.shape.slug,
  title: PostModelSchema.shape.title,
  content: PostModelSchema.shape.content,
  isPublished: PostModelSchema.shape.isPublished,
  isPinned: PostModelSchema.shape.isPinned,
  isHidden: PostModelSchema.shape.isHidden,
  createdAt: PostModelSchema.shape.createdAt,
  updatedAt: PostModelSchema.shape.updatedAt,
})

export type PostDetailQueryResult = z.input<typeof PostDetailQueryResultSchema>
