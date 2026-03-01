<script setup>
import { ref, watch, onMounted } from 'vue'

const props = defineProps({
  code: {
    type: String,
    required: true,
  },
})

const containerRef = ref(null)
const renderError = ref('')

defineExpose({ containerRef })

let mermaid = null
let renderCount = 0

async function getMermaid() {
  if (!mermaid) {
    const mod = await import('mermaid')
    mermaid = mod.default
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      securityLevel: 'loose',
    })
  }
  return mermaid
}

async function renderDiagram(code) {
  if (!containerRef.value || !code.trim()) {
    if (containerRef.value) containerRef.value.innerHTML = ''
    return
  }
  try {
    const m = await getMermaid()
    const id = `mermaid-diagram-${++renderCount}`
    const { svg } = await m.render(id, code)
    containerRef.value.innerHTML = svg
    renderError.value = ''
  } catch (err) {
    renderError.value = err.message ?? 'Diagram syntax error'
    containerRef.value.innerHTML = ''
  }
}

let debounceTimer = null
function debouncedRender(code) {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => renderDiagram(code), 400)
}

watch(() => props.code, (newCode) => {
  debouncedRender(newCode)
})

onMounted(() => {
  renderDiagram(props.code)
})
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-400 font-medium uppercase tracking-wider shrink-0">
      Preview
    </div>

    <div
      v-if="renderError"
      class="px-4 py-2 bg-red-900/60 border-b border-red-700 text-red-300 text-xs font-mono shrink-0"
    >
      {{ renderError }}
    </div>

    <div
      ref="containerRef"
      class="flex-1 overflow-auto p-4 flex items-start justify-center bg-gray-950 [&>svg]:max-w-full [&>svg]:h-auto"
    />
  </div>
</template>
