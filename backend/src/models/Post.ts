import type { Document, PaginateModel, Types } from 'mongoose'
import type { PostEntity } from '../types/entity'
import mongoosePaginate from 'mongoose-paginate-v2'
import mongoose from '../config/db'
import { status } from '../utils/constants'

export interface PostDocument extends Document<Types.ObjectId>, PostEntity {}

type PostModel = PaginateModel<PostDocument>

const postSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    index: {
      unique: true,
    },
    validate: {
      validator (v: any) {
        return /^[\w-]{1,100}$/.test(v)
      },
      message: 'Slug must be 1-100 characters and only contain letters, numbers, dashes and underscores',
    },
  },
  title: {
    type: String,
    required: true,
    validate: {
      validator (v: any) {
        return v.length >= 3 && v.length <= 300
      },
      message: 'Title must be between 3 and 300 characters long',
    },
  },
  content: {
    type: String,
    required: true,
    validate: {
      validator (v: any) {
        return v.length >= 3
      },
      message: 'Content must be at least 3 characters long',
    },
  },
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  pin: {
    type: Boolean,
    default: false,
  },
  status: {
    type: Number,
    default: status.Available,
  },
}, {
  collection: 'Post',
  timestamps: true,
})

postSchema.plugin(mongoosePaginate)

const Post
  = mongoose.model<PostDocument, PostModel>(
    'Post', postSchema,
  )

export default Post
