<script setup lang="ts">
import type { AdminOverviewQueryResult } from '@putongoj/shared'
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { getOverview } from '@/api/admin'
import { useMessage } from '@/utils/message'

const { t } = useI18n()
const router = useRouter()
const message = useMessage()

const loading = ref(true)
const data = ref<AdminOverviewQueryResult | null>(null)

async function fetch () {
  loading.value = true
  try {
    const res = await getOverview()
    data.value = res.data
  } catch {
    message.error(t('ptoj.request_error'))
  } finally {
    loading.value = false
  }
}

onMounted(fetch)

const cards = [
  {
    key: 'users' as const,
    icon: 'pi pi-users',
    label: () => t('ptoj.overview_users'),
    route: 'UserManagement',
    color: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
  },
  {
    key: 'problems' as const,
    icon: 'pi pi-file-edit',
    label: () => t('ptoj.overview_problems'),
    route: 'problemList',
    color: 'text-green-500',
    bg: 'bg-green-50 dark:bg-green-950/30',
  },
  {
    key: 'solutions' as const,
    icon: 'pi pi-copy',
    label: () => t('ptoj.overview_solutions'),
    route: 'SolutionManagement',
    color: 'text-orange-500',
    bg: 'bg-orange-50 dark:bg-orange-950/30',
  },
  {
    key: 'contests' as const,
    icon: 'pi pi-trophy',
    label: () => t('ptoj.overview_contests'),
    route: 'contestList',
    color: 'text-purple-500',
    bg: 'bg-purple-50 dark:bg-purple-950/30',
  },
]
</script>

<template>
  <div class="flex flex-col gap-6 max-w-4xl">
    <!-- Header -->
    <div class="bg-(--p-content-background) border border-surface md:rounded-xl overflow-hidden p-8 relative shadow-md">
      <div class="flex flex-col gap-1 relative z-10">
        <p class="opacity-60 text-sm">
          {{ t('ptoj.admin_panel') }}
        </p>
        <h1 class="font-bold text-2xl">
          {{ t('ptoj.overview') }}
        </h1>
      </div>
      <div class="-right-8 -top-8 absolute bg-linear-to-tr from-primary h-32 opacity-10 rounded-full to-primary/0 w-32" />
      <div class="-bottom-16 -left-12 absolute bg-linear-to-bl from-primary h-48 opacity-10 rounded-full to-primary/0 w-48" />
    </div>

    <!-- Stats Grid -->
    <div class="gap-4 grid grid-cols-2 lg:grid-cols-4">
      <div
        v-for="card in cards"
        :key="card.key"
        class="bg-(--p-content-background) border border-surface cursor-pointer hover:border-primary hover:shadow-md md:rounded-xl overflow-hidden p-6 shadow-sm transition-all"
        @click="router.push({ name: card.route })"
      >
        <div class="flex flex-col gap-4">
          <div :class="['flex h-10 items-center justify-center rounded-lg w-10', card.bg]">
            <i :class="[card.icon, card.color, 'text-xl']" />
          </div>
          <div>
            <p class="opacity-60 text-sm">
              {{ card.label() }}
            </p>
            <p class="font-bold mt-1 text-3xl">
              <i v-if="loading" class="pi pi-spin pi-spinner text-xl" />
              <span v-else>{{ data?.[card.key]?.toLocaleString() ?? '—' }}</span>
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- Quick Links -->
    <div class="bg-(--p-content-background) border border-surface md:rounded-xl overflow-hidden shadow-sm">
      <div class="border-b border-surface flex items-center gap-3 p-6">
        <i class="pi pi-bolt text-primary text-xl" />
        <h2 class="font-semibold text-lg">
          {{ t('ptoj.overview_quick_links') }}
        </h2>
      </div>
      <div class="gap-2 grid grid-cols-2 md:grid-cols-3 p-4">
        <RouterLink
          v-for="link in [
            { name: 'UserManagement', icon: 'pi pi-users', label: t('ptoj.user_management') },
            { name: 'SolutionManagement', icon: 'pi pi-copy', label: t('ptoj.solution_management') },
            { name: 'GroupManagement', icon: 'pi pi-paperclip', label: t('ptoj.group_management') },
            { name: 'tagManager', icon: 'pi pi-tags', label: t('oj.tag_management') },
            { name: 'FileManagement', icon: 'pi pi-folder-open', label: t('ptoj.file_management') },
            { name: 'NotificationCreate', icon: 'pi pi-megaphone', label: t('ptoj.create_notification') },
          ]"
          :key="link.name"
          :to="{ name: link.name }"
          class="flex gap-3 hover:bg-(--p-content-hover-background) items-center p-3 rounded-lg transition-colors"
        >
          <i :class="[link.icon, 'text-muted-color']" />
          <span class="text-sm">{{ link.label }}</span>
        </RouterLink>
      </div>
    </div>
  </div>
</template>
