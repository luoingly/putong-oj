import { z } from 'zod'
import { TITLE_LENGTH_MAX } from '@/consts/index.js'
import { isoDatetimeToDate } from '../codec.js'

export const PostModelSchema = z.object({
  slug: z.string().min(1).max(100),
  title: z.string().min(1).max(TITLE_LENGTH_MAX),
  content: z.string(),
  isPublished: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  isHidden: z.boolean().default(false),
  createdAt: isoDatetimeToDate,
  updatedAt: isoDatetimeToDate,
})

export type PostModel = z.infer<typeof PostModelSchema>
