<script setup>
const props = defineProps({
  previewRef: {
    type: Object,
    default: null,
  },
})

function getSvgElement() {
  // Vue 3 auto-unwraps exposed refs, so .containerRef is already the DOM element
  const el = props.previewRef?.containerRef?.querySelector('svg')
  if (!el) { alert('No diagram rendered yet.'); return null }
  return el
}

function triggerDownload(url, filename) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 100)
}

function exportSvg() {
  const svgEl = getSvgElement()
  if (!svgEl) return
  const svgStr = new XMLSerializer().serializeToString(svgEl)
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' })
  triggerDownload(URL.createObjectURL(blob), 'diagram.svg')
}

async function exportPng() {
  const svgEl = getSvgElement()
  if (!svgEl) return

  const bbox = svgEl.getBoundingClientRect()
  const width = Math.round(bbox.width) || 800
  const height = Math.round(bbox.height) || 600

  const svgStr = new XMLSerializer().serializeToString(svgEl)
  const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr)

  const img = new Image()
  img.width = width
  img.height = height
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = svgDataUrl
  })

  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#111827'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.scale(scale, scale)
  ctx.drawImage(img, 0, 0, width, height)

  triggerDownload(canvas.toDataURL('image/png'), 'diagram.png')
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
</template>
