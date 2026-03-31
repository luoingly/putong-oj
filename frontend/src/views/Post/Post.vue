<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Button from 'primevue/button'
import { computed, onBeforeMount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useRootStore } from '@/store'
import { usePostStore } from '@/store/modules/post'
import { useSessionStore } from '@/store/modules/session'

const { t } = useI18n()
const postStore = usePostStore()
const rootStore = useRootStore()
const route = useRoute()
const router = useRouter()
const current = computed(() => route.name || 'postInfo')
const { isAdmin } = storeToRefs(useSessionStore())

function change (name: string) {
  return router.push({
    name,
    params: { slug: route.params.slug },
  })
}

onBeforeMount(async () => {
  await postStore.findOne(route.params.slug as string)
  rootStore.changeDomTitle({ title: `${postStore.post.title} - Post` })
})
</script>

<template>
  <div class="post-wrap">
    <div v-if="isAdmin" class="flex items-center justify-end px-8">
      <Button v-if="current === 'postInfo'" :label="t('oj.edit')" icon="pi pi-pencil" @click="change('postEdit')" />
      <Button v-else :label="t('oj.overview')" icon="pi pi-eye" @click="change('postInfo')" />
    </div>
    <RouterView class="post-children" />
  </div>
</template>

<style lang="stylus" scoped>
.post-wrap
  width 100%
  max-width 1024px
  padding 24px 0 0

.post-children
  margin-top -16px
  padding 40px

@media screen and (max-width: 1024px)
  .post-wrap
    padding 12px 0 0

  .post-children
    padding 20px
</style>
