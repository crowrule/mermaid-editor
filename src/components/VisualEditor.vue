<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import DiagramCanvas from './DiagramCanvas.vue'

const props = defineProps({
  diagramType: { type: String, required: true },
  diagramDirection: { type: String, default: 'TD' },
  seqAutoNumber: { type: Boolean, default: false },
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
  activations: { type: Array, default: () => [] },
})

const emit = defineEmits([
  'add-node', 'move-node', 'add-edge',
  'delete-node', 'delete-edge', 'update-label', 'update-edge-label',
  'add-attribute', 'delete-attribute', 'update-edge-type',
  'update:diagramDirection', 'update:seqAutoNumber',
  'add-activation', 'delete-activation',
])

const mode = ref('add')
const selectedNodeType = ref('process')
const selectedEdgeType = ref('arrow')
const seqFlowCount   = ref(10)
const seqFlowSpacing = ref(50)

// ── narrow toolbar detection ──────────────────────────────────────────────────
const toolbarRef = ref(null)
const isNarrow = ref(false)
let ro = null
onMounted(() => {
  ro = new ResizeObserver(([entry]) => {
    isNarrow.value = entry.contentRect.width < 640
  })
  if (toolbarRef.value) ro.observe(toolbarRef.value)
})
onUnmounted(() => ro?.disconnect())

// ── toolbar config per diagram type ──────────────────────────────────────────
const toolbarConfig = computed(() => {
  switch (props.diagramType) {
    case 'sequence':
      return {
        nodeTypes: [
          { type: 'participant', label: '👤 Participant' },
          { type: 'actor',       label: '🎭 Actor' },
        ],
        edgeTypes: [
          { type: 'solid',  label: '→ Solid' },
          { type: 'dotted', label: '⇢ Dotted' },
          { type: 'cross',  label: '✕ Cross' },
        ],
      }
    case 'er':
      return {
        nodeTypes: [
          { type: 'entity', label: '▭ Entity' },
        ],
        edgeTypes: [], // set via right-click context menu on the relation line
      }
    case 'class':
      return {
        nodeTypes: [
          { type: 'class', label: '□ Class' },
        ],
        edgeTypes: [
          { type: 'inherit',   label: '◁ Inherit' },
          { type: 'compose',   label: '● Compose' },
          { type: 'aggregate', label: '◇ Aggregate' },
          { type: 'assoc',     label: '→ Assoc' },
        ],
      }
    default: // flowchart
      return {
        nodeTypes: [
          { type: 'process',      label: '☐ Process' },
          { type: 'decision',     label: '◇ Decision' },
          { type: 'terminal',     label: '⬭ Terminal' },
          { type: 'io',           label: '/ IO /' },
          { type: 'database',     label: '🗄 Database' },
          { type: 'multiprocess', label: '⧉ Multi' },
          { type: 'subprocess',   label: '▣ Sub' },
          { type: 'reference',    label: '○ Ref' },
        ],
        edgeTypes: [
          { type: 'arrow',  label: '→ Arrow' },
          { type: 'open',   label: '— Open' },
          { type: 'dotted', label: '⋯ Dotted' },
        ],
      }
  }
})

// ── reset selections when diagram type changes ────────────────────────────────
import { watch } from 'vue'
watch(() => props.diagramType, () => {
  const cfg = toolbarConfig.value
  selectedNodeType.value = cfg.nodeTypes[0]?.type || 'process'
  selectedEdgeType.value = cfg.edgeTypes[0]?.type || 'arrow'
  mode.value = 'add'
})

// ── forward canvas events ─────────────────────────────────────────────────────
function onAddNode(x, y) {
  emit('add-node', x, y, selectedNodeType.value)
}
function onMoveNode(id, x, y) { emit('move-node', id, x, y) }
function onAddEdge(fromId, toId, slot) { emit('add-edge', fromId, toId, selectedEdgeType.value, slot) }
function onDeleteNode(id) { emit('delete-node', id) }
function onDeleteEdge(id) { emit('delete-edge', id) }
function onUpdateLabel(id, label) { emit('update-label', id, label) }
function onUpdateEdgeLabel(id, label) { emit('update-edge-label', id, label) }
function onAddAttribute(nodeId, dataType, name) { emit('add-attribute', nodeId, dataType, name) }
function onDeleteAttribute(nodeId, index) { emit('delete-attribute', nodeId, index) }
function onUpdateEdgeType(id, edgeType) { emit('update-edge-type', id, edgeType) }

// ── button class helpers ──────────────────────────────────────────────────────
function modeClass(m) {
  return mode.value === m
    ? 'bg-indigo-600 text-white'
    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
}
function nodeTypeClass(t) {
  return selectedNodeType.value === t
    ? 'bg-emerald-700 text-white'
    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
}
function edgeTypeClass(t) {
  return selectedEdgeType.value === t
    ? 'bg-indigo-700 text-white'
    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
}
function directionClass(d) {
  return props.diagramDirection === d
    ? 'bg-indigo-600 text-white'
    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
}
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- ── toolbar ── -->
    <div
      ref="toolbarRef"
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1.5 px-3 py-2 bg-gray-800 border-b border-gray-700 shrink-0"
    >
      <!-- Row 1: node type buttons + flowchart direction -->
      <div class="flex flex-wrap gap-1">
        <button
          v-for="nt in toolbarConfig.nodeTypes"
          :key="nt.type"
          :class="['px-2.5 py-1 text-xs rounded transition-colors', nodeTypeClass(nt.type)]"
          @click="selectedNodeType = nt.type"
        >{{ nt.label }}</button>

        <!-- direction toggle (all types except sequence) -->
        <template v-if="diagramType !== 'sequence'">
          <div class="w-px h-5 self-center bg-gray-600" />
          <button
            :class="['px-2.5 py-1 text-xs rounded transition-colors', directionClass('TD')]"
            @click="emit('update:diagramDirection', 'TD')"
          >↓ TD</button>
          <button
            :class="['px-2.5 py-1 text-xs rounded transition-colors', directionClass('LR')]"
            @click="emit('update:diagramDirection', 'LR')"
          >→ LR</button>
        </template>

        <!-- sequence flow settings -->
        <template v-if="diagramType === 'sequence'">
          <div class="w-px h-5 self-center bg-gray-600" />
          <label class="flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              :checked="seqAutoNumber"
              @change="emit('update:seqAutoNumber', $event.target.checked)"
              class="w-3.5 h-3.5 accent-indigo-400 cursor-pointer"
            />
            <span class="text-xs text-gray-300">Numbering</span>
          </label>
          <div class="w-px h-5 self-center bg-gray-600" />
          <span class="text-xs text-gray-400">Flows</span>
          <input
            type="number"
            v-model.number="seqFlowCount"
            min="5" max="100"
            class="w-14 px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
          />
          <span class="text-xs text-gray-400">Spacing</span>
          <input
            type="number"
            v-model.number="seqFlowSpacing"
            min="30" max="150"
            class="w-14 px-1.5 py-0.5 text-xs bg-gray-700 border border-gray-600 rounded text-gray-200 focus:outline-none focus:border-indigo-400"
          />
        </template>
      </div>

      <!-- Row 2: edge types + mode buttons (wraps to new line when narrow) -->
      <div :class="['flex flex-wrap items-center gap-1.5', isNarrow ? 'w-full' : '']">
        <!-- edge type buttons (hidden when diagram uses right-click context menu) -->
        <template v-if="toolbarConfig.edgeTypes.length > 0">
          <div v-if="!isNarrow" class="w-px h-5 bg-gray-600" />
          <div class="flex gap-1">
            <button
              v-for="et in toolbarConfig.edgeTypes"
              :key="et.type"
              :class="['px-2.5 py-1 text-xs rounded transition-colors', edgeTypeClass(et.type)]"
              @click="selectedEdgeType = et.type"
            >{{ et.label }}</button>
          </div>
        </template>

        <div class="w-px h-5 bg-gray-600" />

        <!-- mode buttons -->
        <div class="flex gap-1">
          <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('add')]"     @click="mode = 'add'">+ Add</button>
          <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('select')]"  @click="mode = 'select'">↖ Select</button>
          <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('connect')]" @click="mode = 'connect'">⇢ Connect</button>
          <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('delete')]"  @click="mode = 'delete'">✕ Delete</button>
        </div>

        <!-- hint -->
        <span class="ml-auto text-xs text-gray-500 whitespace-nowrap">
          <template v-if="mode === 'add'">클릭해서 노드 배치</template>
          <template v-else-if="mode === 'connect'">
            <template v-if="diagramType === 'sequence'">흐름 점 클릭 → 다른 참가자 흐름 점 클릭</template>
            <template v-else>출발 → 도착 노드 순서로 클릭</template>
          </template>
          <template v-else-if="mode === 'delete'">클릭해서 삭제 · Del 키</template>
          <template v-else>드래그로 이동 · 더블클릭 이름 변경 · Del 키</template>
        </span>
      </div>
    </div>

    <!-- ── canvas ── -->
    <div class="flex-1 overflow-hidden bg-gray-950">
      <DiagramCanvas
        :nodes="nodes"
        :edges="edges"
        :activations="activations"
        :diagram-type="diagramType"
        :mode="mode"
        :selected-node-type="selectedNodeType"
        :selected-edge-type="selectedEdgeType"
        :seq-flow-count="seqFlowCount"
        :seq-flow-spacing="seqFlowSpacing"
        @add-node="onAddNode"
        @move-node="onMoveNode"
        @add-edge="onAddEdge"
        @delete-node="onDeleteNode"
        @delete-edge="onDeleteEdge"
        @update-node-label="onUpdateLabel"
        @update-edge-label="onUpdateEdgeLabel"
        @add-attribute="onAddAttribute"
        @delete-attribute="onDeleteAttribute"
        @update-edge-type="onUpdateEdgeType"
        @add-activation="(nodeId, s, e) => emit('add-activation', nodeId, s, e)"
        @delete-activation="(id) => emit('delete-activation', id)"
      />
    </div>
  </div>
</template>
