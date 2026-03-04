<script setup>
import { ref, computed, nextTick } from 'vue'

const props = defineProps({
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
  diagramType: { type: String, required: true },
  mode: { type: String, default: 'select' },
  selectedNodeType: { type: String, default: 'process' },
  selectedEdgeType: { type: String, default: 'arrow' },
})

const emit = defineEmits([
  'add-node', 'move-node', 'add-edge',
  'delete-node', 'delete-edge', 'update-node-label',
])

// ── constants ────────────────────────────────────────────────────────────────
const NODE_W = 120
const NODE_H = 48
const SEQ_PARTICIPANT_SPACING = 160
const SEQ_OFFSET_X = 100
const SEQ_LIFELINE_TOP = 80
const SEQ_MESSAGE_START_Y = 110
const SEQ_MESSAGE_SPACING = 50

// ── state ────────────────────────────────────────────────────────────────────
const svgRef = ref(null)
const selectedId = ref(null)
const selectedEdgeId = ref(null)
const connectSource = ref(null)

// drag
let dragging = null
let dragOffX = 0
let dragOffY = 0

// inline edit
const editingNodeId = ref(null)
const editLabel = ref('')
const editInputRef = ref(null)

// ── helpers ──────────────────────────────────────────────────────────────────
function svgPoint(e) {
  const rect = svgRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// ── sequence layout (computed positions, not stored in node) ─────────────────
const isSequence = computed(() => props.diagramType === 'sequence')

function seqX(node) {
  const idx = props.nodes.indexOf(node)
  return SEQ_OFFSET_X + idx * SEQ_PARTICIPANT_SPACING
}

function seqMsgY(edge) {
  const sortedEdges = [...props.edges].sort((a, b) => a.id - b.id)
  const idx = sortedEdges.findIndex(e => e.id === edge.id)
  return SEQ_MESSAGE_START_Y + idx * SEQ_MESSAGE_SPACING
}

function effectiveX(node) {
  return isSequence.value ? seqX(node) : node.x
}
function effectiveY(node) {
  return isSequence.value ? 20 : node.y
}

// ── node shape geometry ───────────────────────────────────────────────────────
function diamondPoints(cx, cy) {
  const w = NODE_W / 2
  const h = NODE_H / 2
  return `${cx},${cy - h} ${cx + w},${cy} ${cx},${cy + h} ${cx - w},${cy}`
}

function parallelogramPoints(cx, cy) {
  const w = NODE_W / 2
  const h = NODE_H / 2
  const skew = 14
  return `${cx - w + skew},${cy - h} ${cx + w + skew},${cy - h} ${cx + w - skew},${cy + h} ${cx - w - skew},${cy + h}`
}

// ── color per type ────────────────────────────────────────────────────────────
const NODE_COLORS = {
  process:      { fill: '#1e3a5f', stroke: '#4a90d9' },
  decision:     { fill: '#3b2a1a', stroke: '#d97706' },
  terminal:     { fill: '#1a3a2a', stroke: '#34d399' },
  io:           { fill: '#2a1a3a', stroke: '#a78bfa' },
  database:     { fill: '#0f2233', stroke: '#38bdf8' },
  multiprocess: { fill: '#2a1a0f', stroke: '#fb923c' },
  subprocess:   { fill: '#1a2a1a', stroke: '#86efac' },
  reference:    { fill: '#2a2a0f', stroke: '#facc15' },
  participant:  { fill: '#1e3a5f', stroke: '#60a5fa' },
  actor:        { fill: '#2a1a2a', stroke: '#f472b6' },
  entity:       { fill: '#1a3a3a', stroke: '#2dd4bf' },
  class:        { fill: '#1e2a3a', stroke: '#818cf8' },
}
function nodeColor(type) {
  return NODE_COLORS[type] || { fill: '#1e3a5f', stroke: '#4a90d9' }
}
function strokeColor(node) {
  if (selectedId.value === node.id) return '#f59e0b'
  if (connectSource.value?.id === node.id) return '#10b981'
  return nodeColor(node.type).stroke
}

// ── edge path helpers ─────────────────────────────────────────────────────────
function edgePath(edge) {
  const fromNode = props.nodes.find(n => n.id === edge.from)
  const toNode   = props.nodes.find(n => n.id === edge.to)
  if (!fromNode || !toNode) return ''
  if (isSequence.value) {
    const x1 = seqX(fromNode)
    const x2 = seqX(toNode)
    const y  = seqMsgY(edge)
    return `M${x1},${y} L${x2},${y}`
  }
  return `M${fromNode.x},${fromNode.y} L${toNode.x},${toNode.y}`
}

function edgeMidpoint(edge) {
  const fromNode = props.nodes.find(n => n.id === edge.from)
  const toNode   = props.nodes.find(n => n.id === edge.to)
  if (!fromNode || !toNode) return { x: 0, y: 0 }
  if (isSequence.value) {
    const x = (seqX(fromNode) + seqX(toNode)) / 2
    const y = seqMsgY(edge) - 10
    return { x, y }
  }
  return {
    x: (fromNode.x + toNode.x) / 2,
    y: (fromNode.y + toNode.y) / 2 - 10,
  }
}

function edgeStrokeDasharray(edgeType) {
  if (edgeType === 'dotted' || edgeType === '-->>') return '6 4'
  return 'none'
}

function edgeMarkerEnd(edgeType) {
  if (edgeType === 'open') return ''
  if (edgeType === 'cross') return 'url(#arrowCross)'
  return 'url(#arrowHead)'
}

// ── mouse handlers ────────────────────────────────────────────────────────────
function onSvgDown(e) {
  if (e.target !== svgRef.value) return
  selectedId.value = null
  selectedEdgeId.value = null
  connectSource.value = null

  if (props.mode === 'add') {
    const pt = svgPoint(e)
    emit('add-node', pt.x, pt.y)
  }
}

function onNodeDown(e, node) {
  e.stopPropagation()
  selectedEdgeId.value = null

  if (props.mode === 'delete') {
    emit('delete-node', node.id)
    return
  }
  if (props.mode === 'connect') {
    if (!connectSource.value) {
      connectSource.value = node
    } else if (connectSource.value.id !== node.id) {
      emit('add-edge', connectSource.value.id, node.id)
      connectSource.value = null
    }
    return
  }
  if (props.mode === 'select') {
    selectedId.value = node.id
    if (!isSequence.value) {
      const pt = svgPoint(e)
      dragging = node
      dragOffX = pt.x - node.x
      dragOffY = pt.y - node.y
    }
  }
}

function onEdgeClick(e, edge) {
  e.stopPropagation()
  if (props.mode === 'delete') {
    emit('delete-edge', edge.id)
    return
  }
  selectedEdgeId.value = edge.id
  selectedId.value = null
}

function onMouseMove(e) {
  if (!dragging) return
  const pt = svgPoint(e)
  emit('move-node', dragging.id, pt.x - dragOffX, pt.y - dragOffY)
}

function onMouseUp() {
  dragging = null
}

// ── inline label editing ──────────────────────────────────────────────────────
function startEdit(node) {
  if (props.mode === 'connect' || props.mode === 'delete') return
  editingNodeId.value = node.id
  editLabel.value = node.label
  nextTick(() => editInputRef.value?.focus())
}

function commitEdit() {
  if (editingNodeId.value !== null) {
    emit('update-node-label', editingNodeId.value, editLabel.value)
    editingNodeId.value = null
  }
}

// ── keyboard delete ───────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editingNodeId.value !== null) return
    if (selectedId.value !== null) {
      emit('delete-node', selectedId.value)
      selectedId.value = null
    } else if (selectedEdgeId.value !== null) {
      emit('delete-edge', selectedEdgeId.value)
      selectedEdgeId.value = null
    }
  }
  if (e.key === 'Escape') {
    connectSource.value = null
    editingNodeId.value = null
  }
}
</script>

<template>
  <svg
    ref="svgRef"
    class="w-full h-full"
    :style="{ cursor: mode === 'add' ? 'crosshair' : mode === 'connect' ? 'cell' : 'default' }"
    tabindex="0"
    @mousedown="onSvgDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @keydown="onKeyDown"
  >
    <!-- ── defs: arrowhead markers ── -->
    <defs>
      <marker id="arrowHead" markerWidth="10" markerHeight="7"
              refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
      </marker>
      <marker id="arrowCross" markerWidth="10" markerHeight="10"
              refX="5" refY="5" orient="auto">
        <line x1="0" y1="0" x2="10" y2="10" stroke="#f87171" stroke-width="2"/>
        <line x1="10" y1="0" x2="0" y2="10" stroke="#f87171" stroke-width="2"/>
      </marker>
    </defs>

    <!-- ── sequence lifelines ── -->
    <template v-if="isSequence">
      <line
        v-for="node in nodes"
        :key="'life-' + node.id"
        :x1="seqX(node)" :y1="SEQ_LIFELINE_TOP"
        :x2="seqX(node)" :y2="9999"
        stroke="#374151" stroke-dasharray="6 4" stroke-width="1"
      />
    </template>

    <!-- ── edges ── -->
    <g
      v-for="edge in edges"
      :key="'edge-' + edge.id"
      class="cursor-pointer"
      @mousedown.stop="onEdgeClick($event, edge)"
    >
      <path
        :d="edgePath(edge)"
        fill="none"
        :stroke="selectedEdgeId === edge.id ? '#f59e0b' : '#60a5fa'"
        stroke-width="2"
        :stroke-dasharray="edgeStrokeDasharray(edge.edgeType)"
        :marker-end="edgeMarkerEnd(edge.edgeType)"
      />
      <!-- hit area -->
      <path :d="edgePath(edge)" fill="none" stroke="transparent" stroke-width="12" />
      <!-- label -->
      <text
        v-if="edge.label"
        :x="edgeMidpoint(edge).x"
        :y="edgeMidpoint(edge).y"
        fill="#d1d5db"
        font-size="11"
        text-anchor="middle"
      >{{ edge.label }}</text>
    </g>

    <!-- ── nodes ── -->
    <g
      v-for="node in nodes"
      :key="'node-' + node.id"
      :class="['cursor-pointer select-none', mode === 'delete' ? 'cursor-not-allowed' : '']"
      @mousedown.stop="onNodeDown($event, node)"
      @dblclick.stop="startEdit(node)"
    >
      <!-- process / participant / entity / class → plain rect -->
      <template v-if="['process','participant','entity','class'].includes(node.type)">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- terminal → stadium (rounded rect) -->
      <template v-if="node.type === 'terminal'">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          rx="24"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- decision → diamond -->
      <template v-if="node.type === 'decision'">
        <polygon
          :points="diamondPoints(effectiveX(node), effectiveY(node))"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- io → parallelogram -->
      <template v-if="node.type === 'io'">
        <polygon
          :points="parallelogramPoints(effectiveX(node), effectiveY(node))"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- database → cylinder (ellipse + rect + ellipse) -->
      <template v-if="node.type === 'database'">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2 + 10"
          :width="NODE_W" :height="NODE_H - 20"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <ellipse
          :cx="effectiveX(node)" :cy="effectiveY(node) + NODE_H / 2 - 10"
          :rx="NODE_W / 2" ry="10"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <ellipse
          :cx="effectiveX(node)" :cy="effectiveY(node) - NODE_H / 2 + 10"
          :rx="NODE_W / 2" ry="10"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- multiprocess → stacked rects -->
      <template v-if="node.type === 'multiprocess'">
        <rect
          :x="effectiveX(node) - NODE_W / 2 + 8"
          :y="effectiveY(node) - NODE_H / 2 - 6"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- subprocess → rect with inner vertical lines (subroutine) -->
      <template v-if="node.type === 'subprocess'">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <line
          :x1="effectiveX(node) - NODE_W / 2 + 10" :y1="effectiveY(node) - NODE_H / 2"
          :x2="effectiveX(node) - NODE_W / 2 + 10" :y2="effectiveY(node) + NODE_H / 2"
          :stroke="strokeColor(node)" stroke-width="1.5"
        />
        <line
          :x1="effectiveX(node) + NODE_W / 2 - 10" :y1="effectiveY(node) - NODE_H / 2"
          :x2="effectiveX(node) + NODE_W / 2 - 10" :y2="effectiveY(node) + NODE_H / 2"
          :stroke="strokeColor(node)" stroke-width="1.5"
        />
      </template>

      <!-- reference → circle -->
      <template v-if="node.type === 'reference'">
        <circle
          :cx="effectiveX(node)" :cy="effectiveY(node)"
          :r="NODE_H / 2"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- actor → stick figure -->
      <template v-if="node.type === 'actor'">
        <circle
          :cx="effectiveX(node)" :cy="effectiveY(node) - 16"
          r="10"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <line
          :x1="effectiveX(node)" :y1="effectiveY(node) - 6"
          :x2="effectiveX(node)" :y2="effectiveY(node) + 10"
          :stroke="nodeColor(node.type).stroke" stroke-width="2"
        />
        <line
          :x1="effectiveX(node) - 14" :y1="effectiveY(node)"
          :x2="effectiveX(node) + 14" :y2="effectiveY(node)"
          :stroke="nodeColor(node.type).stroke" stroke-width="2"
        />
        <line
          :x1="effectiveX(node)" :y1="effectiveY(node) + 10"
          :x2="effectiveX(node) - 10" :y2="effectiveY(node) + 24"
          :stroke="nodeColor(node.type).stroke" stroke-width="2"
        />
        <line
          :x1="effectiveX(node)" :y1="effectiveY(node) + 10"
          :x2="effectiveX(node) + 10" :y2="effectiveY(node) + 24"
          :stroke="nodeColor(node.type).stroke" stroke-width="2"
        />
      </template>

      <!-- label (hidden when editing) -->
      <text
        v-if="editingNodeId !== node.id"
        :x="effectiveX(node)"
        :y="effectiveY(node) + (node.type === 'actor' ? 38 : 5)"
        fill="#f3f4f6"
        font-size="13"
        text-anchor="middle"
        dominant-baseline="middle"
        pointer-events="none"
      >{{ node.label }}</text>
    </g>

    <!-- ── inline label editor ── -->
    <foreignObject
      v-if="editingNodeId !== null"
      :x="(effectiveX(nodes.find(n => n.id === editingNodeId)) || 0) - NODE_W / 2"
      :y="(effectiveY(nodes.find(n => n.id === editingNodeId)) || 0) - 14"
      :width="NODE_W"
      height="28"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
        <input
          ref="editInputRef"
          v-model="editLabel"
          @keydown.enter.stop="commitEdit"
          @keydown.escape.stop="editingNodeId = null"
          @blur="commitEdit"
          style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #60a5fa;font-size:12px;text-align:center;padding:2px 4px;box-sizing:border-box;outline:none;"
        />
      </div>
    </foreignObject>

    <!-- ── empty state hint ── -->
    <text
      v-if="nodes.length === 0"
      x="50%" y="50%"
      fill="#4b5563"
      font-size="15"
      text-anchor="middle"
      dominant-baseline="middle"
      pointer-events="none"
    >Select a node type and click "Add" mode, then click here to place nodes</text>
  </svg>
</template>
