<script setup lang="ts">
import { storeToRefs } from 'pinia'
import InputText from 'primevue/inputtext'
import { useI18n } from 'vue-i18n'
import MarkdownEditor from '@/components/MarkdownEditor.vue'
import { usePostStore } from '@/store/modules/post'

const postStore = usePostStore()

const { t } = useI18n()
const { post } = storeToRefs(postStore)
</script>

<template>
  <div v-if="typeof post.content === 'string'">
    <div class="flex gap-2 mb-4">
      <InputText v-model="post.slug" type="text" size="large" fluid :placeholder="t('ptoj.slug')" />
      <InputText v-model="post.title" type="text" size="large" fluid :placeholder="t('oj.title')" />
    </div>
    <MarkdownEditor v-model="post.content" :height="768" />
  </div>
</template>
