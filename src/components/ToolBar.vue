<script setup>
import { ref } from 'vue'
import { trackEvent } from '../analytics.js'

const props = defineProps({
  previewRef: { type: Object, default: null },
  code:       { type: String, default: '' },
})

const modal    = ref(null)   // { ext, resolve }
const filename = ref('')
const lightMode = ref(false)

function getSvgElement() {
  const el = props.previewRef?.containerRef?.querySelector('svg')
  if (!el) { alert('No diagram rendered yet.'); return null }
  return el
}

function promptFilename(defaultName) {
  const [base, ext] = defaultName.split(/\.(?=[^.]+$)/)
  filename.value = base
  return new Promise(resolve => {
    modal.value = { ext, resolve }
  })
}

function confirmDownload() {
  const { resolve } = modal.value
  modal.value = null
  resolve({ name: filename.value.trim() || 'diagram', light: lightMode.value })
}

function cancelDownload() {
  const { resolve } = modal.value
  modal.value = null
  resolve(null)
}

function handleModalKeydown(e) {
  if (e.key === 'Enter')  confirmDownload()
  if (e.key === 'Escape') cancelDownload()
}

function triggerDownload(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

async function getLightSvgString() {
  const { default: mermaid } = await import('mermaid')
  const lightCode = `%%{init: {'theme': 'default'}}%%\n${props.code}`
  const id = `export-light-${Date.now()}`
  const { svg } = await mermaid.render(id, lightCode)
  return svg
}

async function exportSvg() {
  const svgEl = getSvgElement()
  if (!svgEl) return
  const result = await promptFilename('diagram.svg')
  if (result === null) return
  const { name, light } = result
  trackEvent('export', { format: 'svg' })

  let svgStr
  if (light) {
    svgStr = await getLightSvgString()
  } else {
    svgStr = new XMLSerializer().serializeToString(svgEl)
  }
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(URL.createObjectURL(blob), `${name}.svg`)
}

async function exportPng() {
  const svgEl = getSvgElement()
  if (!svgEl) return
  const result = await promptFilename('diagram.png')
  if (result === null) return
  const { name, light } = result

  let svgStr
  if (light) {
    svgStr = await getLightSvgString()
  } else {
    svgStr = new XMLSerializer().serializeToString(svgEl)
  }

  // parse width/height from rendered SVG element (dark) or a temporary DOM parse (light)
  const bbox = svgEl.getBoundingClientRect()
  const width  = Math.round(bbox.width)  || 800
  const height = Math.round(bbox.height) || 600

  const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr)
  const img = new Image()
  img.width  = width
  img.height = height
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = svgDataUrl
  })

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width  = width  * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = light ? '#ffffff' : '#111827'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, width, height)

  trackEvent('export', { format: 'png' })
  triggerDownload(canvas.toDataURL('image/png'), `${name}.png`)
}
</script>

<template>
  <div class="flex items-center gap-3">
    <button
      @click="exportSvg"
      class="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 text-white text-sm rounded transition-colors"
    >
      Export SVG
    </button>

    <button
      @click="exportPng"
      class="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white text-sm rounded transition-colors"
    >
      Export PNG
    </button>
  </div>

  <!-- Export modal -->
  <Teleport to="body">
    <div
      v-if="modal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      @mousedown.self="cancelDownload"
    >
      <div
        class="bg-gray-800 rounded-lg p-6 w-80 shadow-xl"
        @keydown="handleModalKeydown"
      >
        <p class="text-white text-sm font-medium mb-3">내보내기 설정</p>

        <!-- filename -->
        <div class="flex items-center gap-1 mb-4">
          <input
            v-model="filename"
            autofocus
            class="flex-1 bg-gray-700 text-white text-sm rounded px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="diagram"
          />
          <span class="text-gray-400 text-sm">.{{ modal.ext }}</span>
        </div>

        <!-- theme toggle -->
        <div class="flex items-center gap-2 mb-5">
          <span class="text-gray-400 text-xs">테마</span>
          <div class="flex rounded overflow-hidden border border-gray-600 text-xs">
            <button
              @click="lightMode = false"
              :class="['px-3 py-1 transition-colors', !lightMode ? 'bg-gray-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white']"
            >Dark</button>
            <button
              @click="lightMode = true"
              :class="['px-3 py-1 transition-colors', lightMode ? 'bg-gray-200 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-white']"
            >Light</button>
          </div>
        </div>

        <div class="flex justify-end gap-2">
          <button
            @click="cancelDownload"
            class="px-3 py-1.5 text-sm text-gray-300 hover:text-white rounded transition-colors"
          >
            취소
          </button>
          <button
            @click="confirmDownload"
            class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm rounded transition-colors"
          >
            다운로드
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
