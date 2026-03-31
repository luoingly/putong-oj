<script setup lang="ts">
import Button from 'primevue/button'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import OjPostEdit from '@/components/PostEdit.vue'
import { usePostStore } from '@/store/modules/post'
import { useMessage } from '@/utils/message'

const postStore = usePostStore()
const { create } = postStore
const message = useMessage()
const router = useRouter()
const { t } = useI18n()

const addPost = ref({
  slug: '',
  title: '',
  content: '',
  pin: false,
})

async function submit () {
  const slug = await create(addPost.value)
  message.success(t('ptoj.create_post_success', { slug }))
  router.push({ name: 'postInfo', params: { slug } })
}
postStore.setCurrentPost(addPost)
</script>

<template>
  <div class="post-wrap">
    <h1>{{ t('ptoj.add_post') }}</h1>
    <OjPostEdit />
    <Button :label="t('oj.submit')" class="mt-4" @click="submit" />
  </div>
</template>

<style lang="stylus" scoped>
.post-wrap
  max-width 1024px
h1
  margin-bottom: 20px
</style>
