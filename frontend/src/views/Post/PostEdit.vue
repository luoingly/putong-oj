<script setup lang="ts">
import { storeToRefs } from 'pinia'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import OjPostEdit from '@/components/PostEdit.vue'
import { usePostStore } from '@/store/modules/post'
import { useSessionStore } from '@/store/modules/session'
import { useMessage } from '@/utils/message'

const { t } = useI18n()
const postStore = usePostStore()
const sessionStore = useSessionStore()
const router = useRouter()
const confirm = useConfirm()
const message = useMessage()
const { post } = storeToRefs(postStore)
const { isRoot } = storeToRefs(sessionStore)

async function submit () {
  if (!post.value.title || post.value.title.length === 0) {
    message.error(t('oj.title_is_required'))
    return
  }

  try {
    const slug = await postStore.update(post.value.slug, post.value)
    message.success(t('ptoj.post_has_been_updated', { title: post.value.title }))
    router.push({ name: 'postInfo', params: { slug } })
  } catch (err: any) {
    message.error(err.message)
  }
}

function del (event: Event) {
  return confirm.require({
    target: event.currentTarget as HTMLElement,
    message: '此操作不可恢复，确认删除？',
    rejectProps: {
      label: t('ptoj.cancel'),
      severity: 'secondary',
      outlined: true,
    },
    acceptProps: {
      label: t('ptoj.delete'),
      severity: 'danger',
    },
    accept: async () => {
      const { slug } = post.value
      await postStore.delete(slug)
      message.success(`成功删除 ${slug}！`)
      router.push({ name: 'home' })
    },
  })
}

function switchVisible () {
  if (post.value.status === 2) {
    post.value.status = 0
  } else {
    post.value.status = 2
  }
}

function togglePin () {
  post.value.pin = !post.value.pin
}
</script>

<template>
  <div>
    <OjPostEdit />

    <div class="flex justify-between mt-4">
      <Button :label="t('oj.submit')" icon="pi pi-send" @click="submit" />

      <span v-if="isRoot" class="flex space-x-2">
        <Button
          :label="post.pin ? t('ptoj.unpin') : t('ptoj.pin')"
          :icon="post.pin ? 'pi pi-bookmark-fill' : 'pi pi-bookmark'"
          severity="secondary" outlined @click="togglePin"
        />
        <Button
          :label="post.status === 2 ? 'Hide' : 'Show'" :icon="post.status === 2 ? 'pi pi-eye-slash' : 'pi pi-eye'"
          severity="secondary" outlined @click="switchVisible"
        />
        <Button :label="t('ptoj.delete')" icon="pi pi-trash" severity="danger" outlined @click="del" />
      </span>
    </div>
  </div>
</template>
