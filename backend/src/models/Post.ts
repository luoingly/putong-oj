import { randomUUID } from 'node:crypto'
import mongoose from '../config/db'

const postSchema = new mongoose.Schema({
  slug: {
    type: String,
    required: true,
    unique: true,
    index: true,
    default: () => randomUUID(),
    maxlength: 100,
  },
  title: {
    type: String,
    required: true,
    validate: {
      validator: (v: string) => v.length >= 1 && v.length <= 300,
      message: 'Title must be between 1 and 300 characters long',
    },
  },
  content: {
    type: String,
    default: '',
    validate: {
      validator: (v: string) => typeof v === 'string',
      message: 'Content must be a string',
    },
  },
  isPublished: {
    type: Boolean,
    default: false,
  },
  isPinned: {
    type: Boolean,
    default: false,
  },
  isHidden: {
    type: Boolean,
    default: false,
  },
}, {
  collection: 'Post',
  timestamps: true,
})

const Post = mongoose.model('Post', postSchema)

export default Post
