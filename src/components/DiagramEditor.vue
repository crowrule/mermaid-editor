<script setup>
defineProps({
  code: {
    type: String,
    required: true,
  },
})

const emit = defineEmits(['update:code'])

function handleInput(event) {
  emit('update:code', event.target.value)
}
</script>

<template>
  <div class="flex flex-col h-full">
    <div class="px-3 py-1.5 bg-gray-800 border-b border-gray-700 text-xs text-gray-400 font-medium uppercase tracking-wider shrink-0">
      Editor
    </div>
    <textarea
      :value="code"
      @input="handleInput"
      spellcheck="false"
      autocomplete="off"
      class="flex-1 w-full p-4 bg-gray-950 text-gray-200 font-mono text-sm resize-none outline-none leading-relaxed"
      placeholder="Enter Mermaid diagram code here..."
    />
  </div>
</template>
