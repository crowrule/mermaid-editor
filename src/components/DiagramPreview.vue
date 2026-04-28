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
    // Fix SVG width: mermaid sometimes sets max-width in style, sometimes width="100%" attribute.
    // Either way, replace with an explicit fixed pixel width so the container scrolls instead of shrinking.
    const svgEl = containerRef.value.querySelector('svg')
    if (svgEl) {
      const naturalW = parseFloat(svgEl.style.maxWidth) || svgEl.viewBox.baseVal.width
      if (naturalW) {
        svgEl.removeAttribute('width')
        svgEl.style.width    = naturalW + 'px'
        svgEl.style.maxWidth = 'none'
      }
    }
    // Class diagram: namespace cluster styling
    // mermaid inlines style="fill:none !important" on cluster rects,
    // so we must use setProperty(..., 'important') to win the specificity battle.
    if (code.trim().startsWith('classDiagram') && svgEl) {
      svgEl.querySelectorAll('.cluster rect').forEach(rect => {
        rect.style.setProperty('fill',             '#0d2e22',  'important')
        rect.style.setProperty('stroke',           '#10b981',  'important')
        rect.style.setProperty('stroke-width',     '2px',      'important')
        rect.style.setProperty('stroke-dasharray', '6 3',      'important')
        rect.style.setProperty('rx',               '6',        'important')
      })
      svgEl.querySelectorAll('.cluster-label foreignObject div, .cluster-label text').forEach(el => {
        el.style.setProperty('color',       '#6ee7b7', 'important')
        el.style.setProperty('fill',        '#6ee7b7', 'important')
        el.style.setProperty('font-weight', '700',     'important')
      })
    }

    if (code.trim().startsWith('sequenceDiagram')) {
      if (svgEl) {
        const SHIFT = 20
        // rect.actor 중 y값이 높은 쪽이 bottom actor
        const actorRects = [...svgEl.querySelectorAll('rect.actor')]
        if (actorRects.length >= 2) {
          const yVals = actorRects.map(r => parseFloat(r.getAttribute('y') || '0'))
          const midY = (Math.min(...yVals) + Math.max(...yVals)) / 2
          const moved = new Set()
          actorRects
            .filter(r => parseFloat(r.getAttribute('y') || '0') > midY)
            .forEach(r => {
              const g = r.parentElement
              if (g && !moved.has(g)) {
                moved.add(g)
                const t = g.getAttribute('transform') || ''
                const m = t.match(/translate\(\s*([^,]+),\s*([^)]+)\)/)
                if (m) {
                  g.setAttribute('transform', t.replace(m[0], `translate(${m[1]}, ${parseFloat(m[2]) + SHIFT})`))
                } else {
                  g.setAttribute('transform', (t + ` translate(0, ${SHIFT})`).trim())
                }
              }
            })
          // lifeline y2도 SHIFT만큼 연장
          svgEl.querySelectorAll('line.actor-line').forEach(line => {
            const y2 = parseFloat(line.getAttribute('y2') || '0')
            line.setAttribute('y2', y2 + SHIFT)
          })
          // viewBox를 SHIFT만큼 늘려 잘리지 않게
          const vb = svgEl.viewBox.baseVal
          if (vb.width) svgEl.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height + SHIFT}`)
        }
      }
    }
    renderError.value = ''
  } catch (err) {
    renderError.value = err.message ?? 'Diagram syntax error'
    containerRef.value.innerHTML = ''
    // Reset mermaid instance so next render starts fresh (avoids state corruption)
    mermaid = null
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
      class="flex-1 overflow-auto p-4 flex items-start justify-start bg-gray-950 [&>svg]:h-auto [&>svg]:shrink-0"
    />
  </div>
</template>
