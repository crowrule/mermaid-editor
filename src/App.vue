<script setup>
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { generateCode } from './components/codeGenerator.js'
import VisualEditor from './components/VisualEditor.vue'
import DiagramPreview from './components/DiagramPreview.vue'
import DiagramEditor from './components/DiagramEditor.vue'
import ToolBar from './components/ToolBar.vue'

const diagramType = ref('flowchart')
const diagramDirection = ref('TD')
const nodes = ref([])
const edges = ref([])
const diagramCode = ref('')
const rightTab = ref('preview')
const previewRef = ref(null)

// ── diagram type change confirmation ──────────────────────────────────────────
const pendingDiagramType = ref(null)

function handleDiagramTypeChange(e) {
  const newType = e.target.value
  if (newType === diagramType.value) return
  if (nodes.value.length > 0) {
    pendingDiagramType.value = newType
  } else {
    diagramType.value = newType
  }
}

function confirmDiagramTypeChange() {
  diagramType.value = pendingDiagramType.value
  pendingDiagramType.value = null
}

function cancelDiagramTypeChange() {
  pendingDiagramType.value = null
}

let nodeIdCounter = 1
let edgeIdCounter = 1

// ── resizable divider ──────────────────────────────────────────────────────────
const leftPct = ref(60)
const isResizing = ref(false)
const mainRef = ref(null)

// Minimum panel widths captured at drag start
let minRightPx = 200
let minLeftPx  = 200

function computeMinLeftPx() {
  if (nodes.value.length === 0) return 200
  let maxRight
  if (diagramType.value === 'sequence') {
    // Canvas constants: SEQ_OFFSET_X=100, SEQ_PARTICIPANT_SPACING=160, NODE_W/2=60
    maxRight = 100 + (nodes.value.length - 1) * 160 + 60
  } else {
    // NODE_W/2 = 60 — rightmost edge of the widest node
    maxRight = Math.max(...nodes.value.map(n => (n.x || 0) + 60))
  }
  return Math.max(maxRight + 48, 200) // 48px breathing room
}

function onDividerMousedown(e) {
  isResizing.value = true
  e.preventDefault()
  // Right minimum: mermaid sets style.maxWidth on the SVG to its natural render width
  const svgEl = previewRef.value?.containerRef?.querySelector('svg')
  if (svgEl) {
    const naturalW = parseFloat(svgEl.style.maxWidth) || svgEl.getBoundingClientRect().width
    minRightPx = Math.max(naturalW + 48, 200)
  } else {
    minRightPx = 200
  }
  // Left minimum: rightmost node extent + margin
  minLeftPx = computeMinLeftPx()
}
function onGlobalMousemove(e) {
  if (!isResizing.value || !mainRef.value) return
  const rect = mainRef.value.getBoundingClientRect()
  const DIVIDER_W = 6
  const minLeftPct  = (minLeftPx  / rect.width) * 100
  const maxLeftPct  = ((rect.width - minRightPx - DIVIDER_W) / rect.width) * 100
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  leftPct.value = Math.min(Math.max(pct, Math.max(minLeftPct, 20)), Math.max(maxLeftPct, 20))
}
function onGlobalMouseup() {
  isResizing.value = false
}
onMounted(() => {
  window.addEventListener('mousemove', onGlobalMousemove)
  window.addEventListener('mouseup', onGlobalMouseup)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMousemove)
  window.removeEventListener('mouseup', onGlobalMouseup)
})

// Auto-generate mermaid code whenever visual state changes
watch([diagramType, diagramDirection, nodes, edges], () => {
  diagramCode.value = generateCode(diagramType.value, nodes.value, edges.value, { direction: diagramDirection.value })
}, { deep: true })

// Clear canvas when diagram type changes
watch(diagramType, () => {
  nodes.value = []
  edges.value = []
  nodeIdCounter = 1
  edgeIdCounter = 1
  diagramDirection.value = 'TD'
})

// ── default label per type ────────────────────────────────────────────────────
const DEFAULT_LABELS = {
  process: 'Process', decision: 'Decision', terminal: 'Terminal', io: 'IO',
  database: 'Database', multiprocess: 'Multi', subprocess: 'Sub', reference: 'Ref',
  participant: 'Participant', actor: 'Actor',
  entity: 'Entity', class: 'Class',
}

function uniqueLabel(type) {
  const base = DEFAULT_LABELS[type] || type
  const count = nodes.value.filter(n => n.type === type).length
  return count === 0 ? base : `${base}${count + 1}`
}

// ── node / edge mutations ─────────────────────────────────────────────────────
function handleAddNode(x, y, type) {
  nodes.value.push({
    id: nodeIdCounter++,
    type: type || 'process',
    label: uniqueLabel(type),
    x,
    y,
  })
}

function handleMoveNode(id, x, y) {
  const node = nodes.value.find(n => n.id === id)
  if (node) { node.x = x; node.y = y }
}

function handleAddEdge(fromId, toId, edgeType) {
  // Prevent duplicate edges
  const exists = edges.value.some(e => e.from === fromId && e.to === toId)
  if (exists) return
  edges.value.push({
    id: edgeIdCounter++,
    from: fromId,
    to: toId,
    label: '',
    edgeType: edgeType || 'arrow',
  })
}

function handleDeleteNode(id) {
  nodes.value = nodes.value.filter(n => n.id !== id)
  edges.value = edges.value.filter(e => e.from !== id && e.to !== id)
}

function handleDeleteEdge(id) {
  edges.value = edges.value.filter(e => e.id !== id)
}

function handleUpdateLabel(id, label) {
  const node = nodes.value.find(n => n.id === id)
  if (node) node.label = label
}

function handleCodeChange(code) {
  diagramCode.value = code
}
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- ── header ── -->
    <header class="flex items-center gap-4 px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <h1 class="text-xl font-bold text-indigo-400 tracking-wide">Mermaid Editor</h1>

      <select
        :value="diagramType"
        @change="handleDiagramTypeChange"
        class="px-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 focus:outline-none focus:border-indigo-400 cursor-pointer"
      >
        <option value="flowchart">Flowchart</option>
        <option value="sequence">Sequence</option>
        <option value="er">ER Diagram</option>
        <option value="class">Class Diagram</option>
      </select>

      <ToolBar :preview-ref="previewRef" class="ml-auto" />
    </header>

    <!-- ── main split ── -->
    <main
      ref="mainRef"
      class="flex flex-1 overflow-hidden"
      :style="isResizing ? 'cursor:col-resize;user-select:none' : ''"
    >
      <!-- Left: Visual Editor -->
      <VisualEditor
        class="shrink-0 min-w-0"
        :style="{ width: leftPct + '%' }"
        :diagram-type="diagramType"
        :diagram-direction="diagramDirection"
        :nodes="nodes"
        :edges="edges"
        @add-node="handleAddNode"
        @move-node="handleMoveNode"
        @add-edge="handleAddEdge"
        @delete-node="handleDeleteNode"
        @delete-edge="handleDeleteEdge"
        @update-label="handleUpdateLabel"
        @update:diagram-direction="diagramDirection = $event"
      />

      <!-- Draggable divider -->
      <div
        class="w-1.5 shrink-0 cursor-col-resize transition-colors"
        :class="isResizing ? 'bg-indigo-500' : 'bg-gray-700 hover:bg-indigo-500'"
        @mousedown="onDividerMousedown"
      />

      <!-- Right: Preview / Code tabs -->
      <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
        <!-- tab bar -->
        <div class="flex bg-gray-800 border-b border-gray-700 shrink-0">
          <button
            @click="rightTab = 'preview'"
            :class="[
              'px-4 py-2 text-sm transition-colors',
              rightTab === 'preview'
                ? 'border-b-2 border-indigo-400 text-white'
                : 'text-gray-400 hover:text-gray-200'
            ]"
          >Preview</button>
          <button
            @click="rightTab = 'code'"
            :class="[
              'px-4 py-2 text-sm transition-colors',
              rightTab === 'code'
                ? 'border-b-2 border-indigo-400 text-white'
                : 'text-gray-400 hover:text-gray-200'
            ]"
          >Code</button>
        </div>

        <!-- panel content -->
        <DiagramPreview
          v-show="rightTab === 'preview'"
          ref="previewRef"
          :code="diagramCode"
          class="flex-1 overflow-hidden"
        />
        <DiagramEditor
          v-show="rightTab === 'code'"
          :code="diagramCode"
          @update:code="handleCodeChange"
          class="flex-1 overflow-hidden"
        />
      </div>
    </main>

    <!-- ── diagram type change confirmation modal ── -->
    <Transition name="fade">
      <div
        v-if="pendingDiagramType"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="cancelDiagramTypeChange"
      >
        <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 p-6 flex flex-col gap-4">
          <h2 class="text-base font-semibold text-gray-100">다이어그램 종류 변경</h2>
          <p class="text-sm text-gray-400 leading-relaxed">
            현재 캔버스에 그려진 내용이 모두 삭제됩니다.<br>
            계속 하시겠습니까?
          </p>
          <div class="flex justify-end gap-2">
            <button
              @click="cancelDiagramTypeChange"
              class="px-4 py-1.5 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >취소</button>
            <button
              @click="confirmDiagramTypeChange"
              class="px-4 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >확인</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
