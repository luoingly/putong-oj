<script setup lang="ts">
import { storeToRefs } from 'pinia'
import MarkdownPreview from '@/components/MarkdownPreview.vue'
import { usePostStore } from '@/store/modules/post'
import { timePretty } from '@/utils/format'

const { post } = storeToRefs(usePostStore())
</script>

<template>
  <div>
    <div class="pb-8 pt-4">
      <div class="max-w-xl mx-auto text-center">
        <h1 class="font-bold mb-2 text-4xl/snug text-pretty">
          {{ post.title || '' }}
        </h1>
        <span class="text-muted-color">
          {{ timePretty(post.createdAt, 'yyyy-MM-dd HH:mm') }}
        </span>
      </div>
    </div>
    <MarkdownPreview v-model="post.content" class="pb-4" />
  </div>
</template>
