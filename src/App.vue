<script setup>
import { ref, watch } from 'vue'
import { generateCode } from './components/codeGenerator.js'
import VisualEditor from './components/VisualEditor.vue'
import DiagramPreview from './components/DiagramPreview.vue'
import DiagramEditor from './components/DiagramEditor.vue'
import ToolBar from './components/ToolBar.vue'

const diagramType = ref('flowchart')
const nodes = ref([])
const edges = ref([])
const diagramCode = ref('')
const rightTab = ref('preview')
const previewRef = ref(null)

let nodeIdCounter = 1
let edgeIdCounter = 1

// Auto-generate mermaid code whenever visual state changes
watch([diagramType, nodes, edges], () => {
  diagramCode.value = generateCode(diagramType.value, nodes.value, edges.value)
}, { deep: true })

// Clear canvas when diagram type changes
watch(diagramType, () => {
  nodes.value = []
  edges.value = []
  nodeIdCounter = 1
  edgeIdCounter = 1
})

// ── default label per type ────────────────────────────────────────────────────
const DEFAULT_LABELS = {
  process: 'Process', decision: 'Decision', terminal: 'Terminal', io: 'IO',
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
        v-model="diagramType"
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
    <main class="flex flex-1 overflow-hidden">
      <!-- Left 60%: Visual Editor -->
      <VisualEditor
        class="border-r border-gray-700"
        style="width: 60%;"
        :diagram-type="diagramType"
        :nodes="nodes"
        :edges="edges"
        @add-node="handleAddNode"
        @move-node="handleMoveNode"
        @add-edge="handleAddEdge"
        @delete-node="handleDeleteNode"
        @delete-edge="handleDeleteEdge"
        @update-label="handleUpdateLabel"
      />

      <!-- Right 40%: Preview / Code tabs -->
      <div class="flex flex-col overflow-hidden" style="width: 40%;">
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
  </div>
</template>
