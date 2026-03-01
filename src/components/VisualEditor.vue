<script setup>
import { ref, computed } from 'vue'
import DiagramCanvas from './DiagramCanvas.vue'

const props = defineProps({
  diagramType: { type: String, required: true },
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
})

const emit = defineEmits([
  'add-node', 'move-node', 'add-edge',
  'delete-node', 'delete-edge', 'update-label',
])

const mode = ref('add')
const selectedNodeType = ref('process')
const selectedEdgeType = ref('arrow')

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
        edgeTypes: [
          { type: '1:1',   label: '1:1' },
          { type: '1:N',   label: '1:N' },
          { type: 'N:N',   label: 'N:N' },
          { type: 'strict-1:N', label: '||--|{' },
        ],
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
          { type: 'process',  label: '☐ Process' },
          { type: 'decision', label: '◇ Decision' },
          { type: 'terminal', label: '⬭ Terminal' },
          { type: 'io',       label: '/ IO /' },
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
function onAddEdge(fromId, toId) { emit('add-edge', fromId, toId, selectedEdgeType.value) }
function onDeleteNode(id) { emit('delete-node', id) }
function onDeleteEdge(id) { emit('delete-edge', id) }
function onUpdateLabel(id, label) { emit('update-label', id, label) }

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
</script>

<template>
  <div class="flex flex-col h-full">
    <!-- ── toolbar ── -->
    <div class="flex flex-wrap items-center gap-1.5 px-3 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <!-- node type buttons -->
      <div class="flex gap-1">
        <button
          v-for="nt in toolbarConfig.nodeTypes"
          :key="nt.type"
          :class="['px-2.5 py-1 text-xs rounded transition-colors', nodeTypeClass(nt.type)]"
          @click="selectedNodeType = nt.type"
        >{{ nt.label }}</button>
      </div>

      <div class="w-px h-5 bg-gray-600 mx-1" />

      <!-- edge type buttons -->
      <div class="flex gap-1">
        <button
          v-for="et in toolbarConfig.edgeTypes"
          :key="et.type"
          :class="['px-2.5 py-1 text-xs rounded transition-colors', edgeTypeClass(et.type)]"
          @click="selectedEdgeType = et.type"
        >{{ et.label }}</button>
      </div>

      <div class="w-px h-5 bg-gray-600 mx-1" />

      <!-- mode buttons -->
      <div class="flex gap-1">
        <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('add')]"    @click="mode = 'add'">+ Add</button>
        <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('select')]" @click="mode = 'select'">↖ Select</button>
        <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('connect')]"@click="mode = 'connect'">⇢ Connect</button>
        <button :class="['px-2.5 py-1 text-xs rounded transition-colors', modeClass('delete')]" @click="mode = 'delete'">✕ Delete</button>
      </div>

      <!-- hint -->
      <span class="ml-auto text-xs text-gray-500">
        <template v-if="mode === 'add'">Click canvas to place node</template>
        <template v-else-if="mode === 'connect'">Click source node, then target node</template>
        <template v-else-if="mode === 'delete'">Click node or edge to delete · Del key</template>
        <template v-else>Drag to move · Dbl-click to rename · Del key</template>
      </span>
    </div>

    <!-- ── canvas ── -->
    <div class="flex-1 overflow-hidden bg-gray-950">
      <DiagramCanvas
        :nodes="nodes"
        :edges="edges"
        :diagram-type="diagramType"
        :mode="mode"
        :selected-node-type="selectedNodeType"
        :selected-edge-type="selectedEdgeType"
        @add-node="onAddNode"
        @move-node="onMoveNode"
        @add-edge="onAddEdge"
        @delete-node="onDeleteNode"
        @delete-edge="onDeleteEdge"
        @update-node-label="onUpdateLabel"
      />
    </div>
  </div>
</template>
