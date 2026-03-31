import { defineStore } from 'pinia'
import api from '@/api'

export const usePostStore = defineStore('post', {
  state: () => ({
    list: [] as any[],
    post: {} as any,
    total: 0,
  }),
  actions: {
    async findOne (slug: string) {
      return api.post.findOne(slug).then(({ data }) => {
        this.post = data.post
      })
    },
    async find (payload: any) {
      return api.post.find(payload).then(({ data }) => {
        this.list = data.list.docs
        this.total = data.list.total
      })
    },
    async update (slug: string, payload: any) {
      return api.post.update(slug, payload).then(({ data }) => data.slug)
    },
    async create (payload: any) {
      return api.post.create(payload).then(({ data }) => data.slug)
    },
    async delete (slug: string) {
      return api.post.delete(slug).then(() => {
        this.list = this.list.filter(p => p.slug !== slug)
      })
    },
    setCurrentPost (post: any) {
      this.post = post
    },
  },
})
