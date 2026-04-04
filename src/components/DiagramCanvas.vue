<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  nodes: { type: Array, required: true },
  edges: { type: Array, required: true },
  activations: { type: Array, default: () => [] },
  diagramType: { type: String, required: true },
  mode: { type: String, default: 'select' },
  selectedNodeType: { type: String, default: 'process' },
  selectedEdgeType: { type: String, default: 'arrow' },
  seqFlowCount:   { type: Number, default: 10 },
  seqFlowSpacing: { type: Number, default: 50 },
})

const emit = defineEmits([
  'add-node', 'move-node', 'add-edge',
  'delete-node', 'delete-edge', 'update-node-label', 'update-edge-label',
  'add-attribute', 'delete-attribute', 'update-edge-type',
  'add-activation', 'delete-activation',
  'insert-slot',
])

// Cardinality options for each side of an ER relation
const ER_FROM_CARDS = [
  { value: '||', label: 'Exactly one'  },
  { value: '|o', label: 'Zero or one'  },
  { value: '}|', label: 'One or more'  },
  { value: '}o', label: 'Zero or more' },
]
const ER_TO_CARDS = [
  { value: '||', label: 'Exactly one'  },
  { value: 'o|', label: 'Zero or one'  },
  { value: '|{', label: 'One or more'  },
  { value: 'o{', label: 'Zero or more' },
]

function parseERSides(edgeType) {
  if (edgeType?.includes('--')) {
    const [left, right] = edgeType.split('--')
    return { left, right }
  }
  // legacy preset fallback
  switch (edgeType) {
    case '1:1':        return { left: '||', right: '||' }
    case 'N:N':        return { left: '}o', right: 'o{' }
    case 'strict-1:N': return { left: '||', right: '|{' }
    default:           return { left: '||', right: 'o{' }
  }
}

// ── constants ────────────────────────────────────────────────────────────────
const NODE_W = 120
const NODE_H = 48
const SEQ_PARTICIPANT_SPACING = 160
const SEQ_OFFSET_X = 100
const SEQ_LIFELINE_TOP = 80
const SEQ_MESSAGE_START_Y = 110
// SEQ_MESSAGE_SPACING removed — now driven by seqFlowSpacing prop
const SEQ_BODY_PADDING = 20  // vertical padding at top of scrollable body SVG

// ── state ────────────────────────────────────────────────────────────────────
const containerRef = ref(null)
const svgRef = ref(null)
const headerSvgRef = ref(null)

// context menu (ER edge type)
const ctxEdgeId = ref(null)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxEdge = computed(() =>
  ctxEdgeId.value !== null ? props.edges.find(e => e.id === ctxEdgeId.value) ?? null : null
)
const ctxParsed = computed(() => parseERSides(ctxEdge.value?.edgeType))
const ctxFromNode = computed(() => ctxEdge.value ? props.nodes.find(n => n.id === ctxEdge.value.from) : null)
const ctxToNode   = computed(() => ctxEdge.value ? props.nodes.find(n => n.id === ctxEdge.value.to)   : null)
// Close menu when clicking outside the canvas container
function onDocMousedown(e) {
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    ctxEdgeId.value = null
    slotCtxVisible.value = false
  }
}
onMounted(() => document.addEventListener('mousedown', onDocMousedown))
onUnmounted(() => document.removeEventListener('mousedown', onDocMousedown))
const selectedId = ref(null)
const selectedEdgeId = ref(null)
const connectSource = ref(null)
const connectSourceNode = computed(() =>
  isSequence.value && connectSource.value?.nodeId !== undefined
    ? props.nodes.find(n => n.id === connectSource.value.nodeId) ?? null
    : null
)

// drag
let dragging = null
let dragOffX = 0
let dragOffY = 0

// inline edit — node
const editingNodeId = ref(null)
const editLabel = ref('')
const editInputRef = ref(null)

// inline add attribute
const addingAttrNodeId = ref(null)
const newAttrType = ref('string')
const newAttrName = ref('')
const newAttrTypeInputRef = ref(null)
const newAttrNameInputRef = ref(null)

// inline edit — edge
const editingEdgeId = ref(null)
const editEdgeLabel = ref('')
const editEdgeInputRef = ref(null)
const editingEdge = computed(() =>
  editingEdgeId.value !== null
    ? props.edges.find(e => e.id === editingEdgeId.value) ?? null
    : null
)
// If the edge being edited disappears (e.g. deleted), cancel the edit
watch(editingEdge, (e) => { if (editingEdgeId.value !== null && !e) editingEdgeId.value = null })

// ── helpers ──────────────────────────────────────────────────────────────────
function svgPoint(e) {
  const rect = svgRef.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

// ── entity attribute helpers ──────────────────────────────────────────────────
function entityHeight(node) {
  return NODE_H + (node.attributes?.length || 0) * 20
}
// Geometric center of the full entity box (shifted down by half the attribute area)
function erEntityCenter(node) {
  return { x: node.x, y: node.y + (node.attributes?.length || 0) * 10 }
}

// ── sequence layout helpers ───────────────────────────────────────────────────
const isSequence = computed(() => props.diagramType === 'sequence')

// Height of the scrollable body SVG
const seqBodyHeight = computed(() =>
  SEQ_BODY_PADDING + props.seqFlowCount * props.seqFlowSpacing + 40
)
// Width shared by header SVG and body SVG
const seqCanvasWidth = computed(() => {
  const n = props.nodes.length
  if (n === 0) return 400
  return SEQ_OFFSET_X + (n - 1) * SEQ_PARTICIPANT_SPACING + NODE_W + 80
})

function seqX(node) {
  const idx = props.nodes.indexOf(node)
  return SEQ_OFFSET_X + idx * SEQ_PARTICIPANT_SPACING
}

function seqMsgY(edge) {
  // Coordinates are relative to the scrollable body SVG (y=0 = just below header)
  return SEQ_BODY_PADDING + (edge.slot ?? 0) * props.seqFlowSpacing
}

function effectiveX(node) {
  return isSequence.value ? seqX(node) : node.x
}
function effectiveY(node) {
  return isSequence.value ? NODE_H / 2 + 20 : node.y
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

// Intersection of a ray from (cx,cy) in direction (ux,uy) with a rect of given half-dimensions
function entityBoundaryPoint(cx, cy, ux, uy, halfW = NODE_W / 2, halfH = NODE_H / 2) {
  const w = halfW, h = halfH
  const adx = Math.abs(ux), ady = Math.abs(uy)
  if (adx < 0.0001 && ady < 0.0001) return { x: cx, y: cy }
  if (adx * h > ady * w) {
    const t = w / adx
    return { x: cx + Math.sign(ux) * w, y: cy + uy * t }
  } else {
    const t = h / ady
    return { x: cx + ux * t, y: cy + Math.sign(uy) * h }
  }
}

function edgePath(edge) {
  const fromNode = props.nodes.find(n => n.id === edge.from)
  const toNode   = props.nodes.find(n => n.id === edge.to)
  if (!fromNode || !toNode) return ''
  if (isSequence.value) {
    const x1 = seqX(fromNode)
    const x2 = seqX(toNode)
    const y  = seqMsgY(edge)
    if (fromNode.id === toNode.id) {
      // Self-loop: right-side rectangular arc
      return `M ${x1},${y} L ${x1+50},${y} L ${x1+50},${y+24} L ${x1},${y+24}`
    }
    return `M${x1},${y} L${x2},${y}`
  }
  // ER: path from entity boundary to entity boundary using geometric center of expanded box
  if (props.diagramType === 'er') {
    const fc = erEntityCenter(fromNode)
    const tc = erEntityCenter(toNode)
    const dx = tc.x - fc.x, dy = tc.y - fc.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const ux = dx / len, uy = dy / len
    const fp = entityBoundaryPoint(fc.x, fc.y,  ux,  uy, NODE_W / 2, entityHeight(fromNode) / 2)
    const tp = entityBoundaryPoint(tc.x, tc.y, -ux, -uy, NODE_W / 2, entityHeight(toNode) / 2)
    return `M${fp.x},${fp.y} L${tp.x},${tp.y}`
  }
  return `M${fromNode.x},${fromNode.y} L${toNode.x},${toNode.y}`
}

function edgeMidpoint(edge) {
  if (!edge) return { x: 0, y: 0 }
  const fromNode = props.nodes.find(n => n.id === edge.from)
  const toNode   = props.nodes.find(n => n.id === edge.to)
  if (!fromNode || !toNode) return { x: 0, y: 0 }
  if (isSequence.value) {
    if (fromNode.id === toNode.id) {
      return { x: seqX(fromNode) + 58, y: seqMsgY(edge) + 12 }
    }
    const x = (seqX(fromNode) + seqX(toNode)) / 2
    const y = seqMsgY(edge) - 10
    return { x, y }
  }
  if (props.diagramType === 'er') {
    const fc = erEntityCenter(fromNode)
    const tc = erEntityCenter(toNode)
    return { x: (fc.x + tc.x) / 2, y: (fc.y + tc.y) / 2 - 10 }
  }
  return {
    x: (fromNode.x + toNode.x) / 2,
    y: (fromNode.y + toNode.y) / 2 - 10,
  }
}

function edgeStrokeDasharray(edgeType) {
  if (props.diagramType === 'er') return 'none'
  if (edgeType === 'dotted' || edgeType === '-->>') return '6 4'
  return 'none'
}

const ER_START_MARKER = {
  '||': 'url(#er-s-exact-one)',
  '|o': 'url(#er-s-zero-one)',
  '}|': 'url(#er-s-one-more)',
  '}o': 'url(#er-s-zero-more)',
}
const ER_END_MARKER = {
  '||': 'url(#er-e-exact-one)',
  'o|': 'url(#er-e-zero-one)',
  '|{': 'url(#er-e-one-more)',
  'o{': 'url(#er-e-zero-more)',
}

function edgeMarkerStart(edge) {
  if (props.diagramType !== 'er') return ''
  const { left } = parseERSides(edge.edgeType)
  return ER_START_MARKER[left] ?? 'url(#er-s-exact-one)'
}

function edgeMarkerEnd(edge) {
  if (props.diagramType !== 'er') {
    if (edge.edgeType === 'open') return ''
    if (edge.edgeType === 'cross') return 'url(#arrowCross)'
    return 'url(#arrowHead)'
  }
  const { right } = parseERSides(edge.edgeType)
  return ER_END_MARKER[right] ?? 'url(#er-e-zero-more)'
}

// ── mouse handlers ────────────────────────────────────────────────────────────

// Called when the transparent background rect is clicked (guarantees background-only hit)
function onBgMousedown(e) {
  selectedId.value = null
  selectedEdgeId.value = null
  connectSource.value = null
  addingAttrNodeId.value = null
  ctxEdgeId.value = null
  slotCtxVisible.value = false

  // Sequence: add-node is handled by the sticky header; body clicks only clear state
  if (props.mode === 'add' && !isSequence.value) {
    const pt = svgPoint(e)
    const MARGIN = 20
    const x = Math.max(NODE_W / 2 + MARGIN, pt.x)
    const y = Math.max(NODE_H / 2 + MARGIN, pt.y)
    emit('add-node', x, y)
  }
}

// Called when clicking the sticky sequence header background
function onHeaderMousedown(e) {
  selectedId.value = null
  selectedEdgeId.value = null
  connectSource.value = null
  ctxEdgeId.value = null
  if (props.mode === 'add') {
    const rect = headerSvgRef.value.getBoundingClientRect()
    const x = Math.max(NODE_W / 2 + 20, e.clientX - rect.left)
    emit('add-node', x, 0)
  }
}

function onNodeDown(e, node) {
  e.stopPropagation()
  selectedEdgeId.value = null
  if (addingAttrNodeId.value !== null && addingAttrNodeId.value !== node.id)
    addingAttrNodeId.value = null

  if (props.mode === 'delete') {
    emit('delete-node', node.id)
    return
  }
  if (props.mode === 'connect') {
    if (isSequence.value) return  // slot circles handle connect in sequence
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

function onEdgeContextMenu(e, edge) {
  if (props.diagramType !== 'er') return
  const rect = containerRef.value.getBoundingClientRect()
  ctxX.value = e.clientX - rect.left
  ctxY.value = e.clientY - rect.top
  ctxEdgeId.value = edge.id
}

function selectFromCard(card) {
  if (ctxEdgeId.value !== null)
    emit('update-edge-type', ctxEdgeId.value, `${card}--${ctxParsed.value.right}`)
}
function selectToCard(card) {
  if (ctxEdgeId.value !== null)
    emit('update-edge-type', ctxEdgeId.value, `${ctxParsed.value.left}--${card}`)
}

function onEdgeClick(e, edge) {
  e.stopPropagation()
  ctxEdgeId.value = null
  addingAttrNodeId.value = null
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

function startEdgeEdit(edge) {
  if (props.mode === 'delete') return
  editingEdgeId.value = edge.id
  editEdgeLabel.value = edge.label || ''
  nextTick(() => editEdgeInputRef.value?.focus())
}

function startAddAttr(node, e) {
  e?.stopPropagation()
  addingAttrNodeId.value = node.id
  newAttrType.value = 'string'
  newAttrName.value = ''
  nextTick(() => newAttrTypeInputRef.value?.focus())
}

function commitAddAttr() {
  if (addingAttrNodeId.value !== null) {
    const name = newAttrName.value.trim()
    const type = newAttrType.value.trim() || 'string'
    if (name) emit('add-attribute', addingAttrNodeId.value, type, name)
    addingAttrNodeId.value = null
  }
}

function onAttrRowMousedown(e, nodeId, index) {
  // Attribute row always stops propagation to prevent entity select/delete
  if (props.mode === 'delete') emit('delete-attribute', nodeId, index)
}

function commitEdgeEdit() {
  if (editingEdgeId.value !== null) {
    emit('update-edge-label', editingEdgeId.value, editEdgeLabel.value)
    editingEdgeId.value = null
  }
}

// ── slot insert context menu ──────────────────────────────────────────────────
const slotCtxVisible = ref(false)
const slotCtxX = ref(0)
const slotCtxY = ref(0)
const slotCtxSlot = ref(0)

function onSlotDown(event, node, slotIdx) {
  if (props.mode === 'select') {
    const rect = containerRef.value.getBoundingClientRect()
    slotCtxX.value = event.clientX - rect.left + 8
    slotCtxY.value = event.clientY - rect.top + 8
    slotCtxSlot.value = slotIdx
    slotCtxVisible.value = true
    return
  }
  if (props.mode === 'connect') {
    onSlotClick(node, slotIdx)
  }
}

function slotInsert(position) {
  emit('insert-slot', slotCtxSlot.value, position)
  slotCtxVisible.value = false
}

// ── occupied slots (sequence) ─────────────────────────────────────────────────
const occupiedSlots = computed(() =>
  new Set(props.edges.filter(e => e.slot !== undefined).map(e => e.slot))
)

// ── sequence slot circle click ────────────────────────────────────────────────
function onSlotClick(node, slotIdx) {
  if (props.mode !== 'connect') return
  if (!connectSource.value) {
    connectSource.value = { nodeId: node.id, slot: slotIdx }
  } else if (connectSource.value.nodeId !== node.id) {
    // Different lifeline → block if source slot already has a flow
    if (occupiedSlots.value.has(connectSource.value.slot)) return
    emit('add-edge', connectSource.value.nodeId, node.id, connectSource.value.slot)
    connectSource.value = null
  } else if (connectSource.value.slot !== slotIdx) {
    // Same lifeline, different slot → activation range
    const startSlot = Math.min(connectSource.value.slot, slotIdx)
    const endSlot   = Math.max(connectSource.value.slot, slotIdx)
    emit('add-activation', node.id, startSlot, endSlot)
    connectSource.value = null
  } else {
    // Same lifeline, same slot → cancel selection
    connectSource.value = null
  }
}

function onActivationClick(act) {
  if (confirm('이 Activation 블록을 삭제하시겠습니까?')) {
    emit('delete-activation', act.id)
  }
}

function onSelfLoop() {
  if (!connectSource.value || !isSequence.value) return
  emit('add-edge', connectSource.value.nodeId, connectSource.value.nodeId, connectSource.value.slot)
  connectSource.value = null
}

// ── keyboard delete ───────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editingNodeId.value !== null)   return
    if (editingEdgeId.value !== null)   return
    if (addingAttrNodeId.value !== null) return
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
    editingEdgeId.value = null
    addingAttrNodeId.value = null
    ctxEdgeId.value = null
  }
}
</script>

<template>
  <div ref="containerRef" class="w-full h-full flex flex-col overflow-hidden" style="position:relative">

  <!-- ── SEQUENCE: sticky header + scrollable body ───────────────────────────── -->
  <template v-if="isSequence">

    <!-- Fixed header: participant/actor boxes + lifeline stubs -->
    <div class="flex-shrink-0 overflow-hidden bg-gray-950"
         :style="{ cursor: mode === 'add' ? 'crosshair' : mode === 'delete' ? 'not-allowed' : 'default' }">
      <svg ref="headerSvgRef" :width="seqCanvasWidth" :height="SEQ_MESSAGE_START_Y" style="display:block">
        <rect x="0" y="0" :width="seqCanvasWidth" :height="SEQ_MESSAGE_START_Y"
              fill="transparent" @mousedown="onHeaderMousedown" />
        <!-- lifeline stubs (top portion) -->
        <line v-for="node in nodes" :key="'hlife-' + node.id"
              :x1="seqX(node)" :y1="SEQ_LIFELINE_TOP"
              :x2="seqX(node)" :y2="SEQ_MESSAGE_START_Y"
              stroke="#374151" stroke-dasharray="6 4" stroke-width="1" />
        <!-- participant / actor nodes -->
        <g v-for="node in nodes" :key="'hn-' + node.id"
           :class="['cursor-pointer select-none', mode === 'delete' ? 'cursor-not-allowed' : '']"
           @mousedown.stop="onNodeDown($event, node)"
           @dblclick.stop="startEdit(node)">
          <template v-if="node.type === 'participant'">
            <rect :x="effectiveX(node) - NODE_W / 2" :y="effectiveY(node) - NODE_H / 2"
                  :width="NODE_W" :height="NODE_H"
                  :fill="nodeColor('participant').fill" :stroke="strokeColor(node)" stroke-width="2" />
          </template>
          <template v-else-if="node.type === 'actor'">
            <circle :cx="effectiveX(node)" :cy="effectiveY(node) - 16" r="10"
                    :fill="nodeColor('actor').fill" :stroke="strokeColor(node)" stroke-width="2" />
            <line :x1="effectiveX(node)" :y1="effectiveY(node) - 6"
                  :x2="effectiveX(node)" :y2="effectiveY(node) + 10"
                  :stroke="nodeColor('actor').stroke" stroke-width="2" />
            <line :x1="effectiveX(node) - 14" :y1="effectiveY(node)"
                  :x2="effectiveX(node) + 14" :y2="effectiveY(node)"
                  :stroke="nodeColor('actor').stroke" stroke-width="2" />
            <line :x1="effectiveX(node)" :y1="effectiveY(node) + 10"
                  :x2="effectiveX(node) - 10" :y2="effectiveY(node) + 24"
                  :stroke="nodeColor('actor').stroke" stroke-width="2" />
            <line :x1="effectiveX(node)" :y1="effectiveY(node) + 10"
                  :x2="effectiveX(node) + 10" :y2="effectiveY(node) + 24"
                  :stroke="nodeColor('actor').stroke" stroke-width="2" />
          </template>
          <text v-if="editingNodeId !== node.id"
                :x="effectiveX(node)" :y="effectiveY(node) + (node.type === 'actor' ? 38 : 5)"
                fill="#f3f4f6" font-size="13" text-anchor="middle" dominant-baseline="middle"
                pointer-events="none">{{ node.label }}</text>
        </g>
        <!-- empty state hint in header -->
        <text v-if="nodes.length === 0" x="50%" y="55%"
              fill="#4b5563" font-size="14" text-anchor="middle" dominant-baseline="middle"
              pointer-events="none">Add 모드에서 클릭해서 Participant / Actor 추가</text>
        <!-- inline label editor (participants) -->
        <foreignObject v-if="editingNodeId !== null"
          :x="(seqX(nodes.find(n => n.id === editingNodeId)) || 0) - NODE_W / 2"
          :y="(effectiveY(nodes.find(n => n.id === editingNodeId)) || 0) - 14"
          :width="NODE_W" height="28">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
            <input ref="editInputRef" v-model="editLabel"
                   @keydown.enter.stop="commitEdit"
                   @keydown.escape.stop="editingNodeId = null"
                   @blur="commitEdit"
                   style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #60a5fa;font-size:12px;text-align:center;padding:2px 4px;box-sizing:border-box;outline:none;" />
          </div>
        </foreignObject>
      </svg>
    </div>

    <!-- Scrollable body: lifelines + slot circles + edges -->
    <div class="flex-1 overflow-y-auto overflow-x-auto bg-gray-950">
      <svg ref="svgRef" :width="seqCanvasWidth" :height="seqBodyHeight" style="display:block;outline:none"
           :style="{ cursor: mode === 'connect' ? 'cell' : 'default' }"
           tabindex="0"
           @mousemove="onMouseMove" @mouseup="onMouseUp" @keydown="onKeyDown" @contextmenu.prevent>
        <defs>
          <marker id="arrowHead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
          </marker>
          <marker id="arrowCross" markerWidth="10" markerHeight="10" refX="5" refY="5" orient="auto">
            <line x1="0" y1="0" x2="10" y2="10" stroke="#f87171" stroke-width="2"/>
            <line x1="10" y1="0" x2="0" y2="10" stroke="#f87171" stroke-width="2"/>
          </marker>
        </defs>
        <rect x="0" y="0" :width="seqCanvasWidth" :height="seqBodyHeight"
              fill="transparent" @mousedown="onBgMousedown" />
        <!-- lifelines (full body height) -->
        <line v-for="node in nodes" :key="'life-' + node.id"
              :x1="seqX(node)" y1="0" :x2="seqX(node)" :y2="seqBodyHeight"
              stroke="#374151" stroke-dasharray="6 4" stroke-width="1" />
        <!-- activation blocks -->
        <template v-for="act in activations" :key="'act-' + act.id">
          <g v-if="nodes.find(n => n.id === act.nodeId)"
             style="cursor:pointer"
             @mousedown.stop="onActivationClick(act)">
            <rect
              :x="seqX(nodes.find(n => n.id === act.nodeId)) - 8"
              :y="SEQ_BODY_PADDING + act.startSlot * seqFlowSpacing"
              width="16"
              :height="(act.endSlot - act.startSlot) * seqFlowSpacing"
              fill="#4f46e5" fill-opacity="0.6"
              stroke="#818cf8" stroke-width="1.5"
              rx="2"
            />
          </g>
        </template>
        <!-- slot circles -->
        <template v-for="node in nodes" :key="'slots-' + node.id">
          <g v-for="si in seqFlowCount" :key="'slot-' + si"
             :style="(mode === 'connect' || mode === 'select') ? 'cursor:pointer' : 'pointer-events:none'"
             @mousedown.stop="onSlotDown($event, node, si - 1)">
            <circle
              :cx="seqX(node)"
              :cy="SEQ_BODY_PADDING + (si - 1) * seqFlowSpacing"
              :r="mode === 'connect' ? 12 : 7"
              :fill="connectSource && connectSource.nodeId === node.id && connectSource.slot === si - 1
                     ? '#10b981'
                     : mode === 'connect' && occupiedSlots.has(si - 1)
                       ? '#78350f'
                       : (mode === 'connect' ? '#1e3a6e' : '#1f2937')"
              :stroke="connectSource && connectSource.nodeId === node.id && connectSource.slot === si - 1
                       ? '#10b981'
                       : mode === 'connect' && occupiedSlots.has(si - 1)
                         ? '#f59e0b'
                         : (mode === 'connect' ? '#60a5fa' : '#374151')"
              stroke-width="1.5"
            />
            <text
              :x="seqX(node)"
              :y="SEQ_BODY_PADDING + (si - 1) * seqFlowSpacing"
              text-anchor="middle" dominant-baseline="central"
              :font-size="mode === 'connect' ? 9 : 7"
              :fill="connectSource && connectSource.nodeId === node.id && connectSource.slot === si - 1
                     ? 'white'
                     : mode === 'connect' && occupiedSlots.has(si - 1)
                       ? '#fcd34d'
                       : (mode === 'connect' ? '#93c5fd' : '#6b7280')"
              pointer-events="none"
            >{{ si }}</text>
          </g>
        </template>
        <!-- self-loop button -->
        <g v-if="mode === 'connect' && connectSource && connectSourceNode"
           style="cursor:pointer" @mousedown.stop="onSelfLoop">
          <rect :x="seqX(connectSourceNode) + 10"
                :y="SEQ_BODY_PADDING + connectSource.slot * seqFlowSpacing - 10"
                width="44" height="20" rx="3" fill="#7c3aed" opacity="0.9" />
          <text :x="seqX(connectSourceNode) + 32"
                :y="SEQ_BODY_PADDING + connectSource.slot * seqFlowSpacing + 5"
                fill="white" font-size="11" text-anchor="middle" pointer-events="none">↩ Self</text>
        </g>
        <!-- edges -->
        <g v-for="edge in edges" :key="'edge-' + edge.id" class="cursor-pointer"
           @mousedown.stop="onEdgeClick($event, edge)"
           @dblclick.stop="startEdgeEdit(edge)">
          <path :d="edgePath(edge)" fill="none"
                :stroke="selectedEdgeId === edge.id ? '#f59e0b' : '#60a5fa'"
                stroke-width="2"
                :stroke-dasharray="edgeStrokeDasharray(edge.edgeType)"
                :marker-end="edgeMarkerEnd(edge)" />
          <path :d="edgePath(edge)" fill="none" stroke="transparent" stroke-width="12" />
          <text v-if="edge.label" :x="edgeMidpoint(edge).x" :y="edgeMidpoint(edge).y"
                fill="#d1d5db" font-size="11" text-anchor="middle">{{ edge.label }}</text>
        </g>
        <!-- edge label editor -->
        <foreignObject v-if="editingEdge"
          :x="edgeMidpoint(editingEdge).x - 70" :y="edgeMidpoint(editingEdge).y - 2"
          width="140" height="26">
          <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
            <input ref="editEdgeInputRef" v-model="editEdgeLabel"
                   @keydown.enter.stop="commitEdgeEdit"
                   @keydown.escape.stop="editingEdgeId = null"
                   @blur="commitEdgeEdit"
                   style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #818cf8;font-size:12px;text-align:center;padding:2px 4px;box-sizing:border-box;outline:none;border-radius:3px;" />
          </div>
        </foreignObject>
      </svg>
    </div>

  </template>

  <!-- ── NON-SEQUENCE: single SVG (flowchart / ER / class) ──────────────────── -->
  <svg
    v-else
    ref="svgRef"
    class="w-full h-full"
    style="outline:none"
    :style="{ cursor: mode === 'add' ? 'crosshair' : mode === 'connect' ? 'cell' : 'default' }"
    tabindex="0"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
    @keydown="onKeyDown"
    @contextmenu.prevent
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

      <!-- ER cardinality markers — START (entity at low-x, path goes right) -->
      <!-- || exactly one: two bars -->
      <marker id="er-s-exact-one" markerWidth="9" markerHeight="14" refX="1" refY="7" orient="auto">
        <line x1="2" y1="1" x2="2" y2="13" stroke="#60a5fa" stroke-width="2"/>
        <line x1="6" y1="1" x2="6" y2="13" stroke="#60a5fa" stroke-width="2"/>
      </marker>
      <!-- |o zero-or-one: bar (max) + circle (min) -->
      <marker id="er-s-zero-one" markerWidth="13" markerHeight="14" refX="1" refY="7" orient="auto">
        <line x1="2" y1="1" x2="2" y2="13" stroke="#60a5fa" stroke-width="2"/>
        <circle cx="8" cy="7" r="3" stroke="#60a5fa" fill="none" stroke-width="1.5"/>
      </marker>
      <!-- }| one-or-more: crow's foot (max) + bar (min) -->
      <marker id="er-s-one-more" markerWidth="16" markerHeight="14" refX="1" refY="7" orient="auto">
        <path d="M 9,7 L 2,1 M 9,7 L 2,7 M 9,7 L 2,13" stroke="#60a5fa" stroke-width="1.5" fill="none"/>
        <line x1="13" y1="1" x2="13" y2="13" stroke="#60a5fa" stroke-width="2"/>
      </marker>
      <!-- }o zero-or-more: crow's foot (max) + circle (min) -->
      <marker id="er-s-zero-more" markerWidth="19" markerHeight="14" refX="1" refY="7" orient="auto">
        <path d="M 9,7 L 2,1 M 9,7 L 2,7 M 9,7 L 2,13" stroke="#60a5fa" stroke-width="1.5" fill="none"/>
        <circle cx="14" cy="7" r="3" stroke="#60a5fa" fill="none" stroke-width="1.5"/>
      </marker>

      <!-- ER cardinality markers — END (entity at high-x, path comes from left) -->
      <!-- || exactly one: two bars -->
      <marker id="er-e-exact-one" markerWidth="9" markerHeight="14" refX="8" refY="7" orient="auto">
        <line x1="3" y1="1" x2="3" y2="13" stroke="#60a5fa" stroke-width="2"/>
        <line x1="7" y1="1" x2="7" y2="13" stroke="#60a5fa" stroke-width="2"/>
      </marker>
      <!-- o| zero-or-one: circle (min) + bar (max) -->
      <marker id="er-e-zero-one" markerWidth="13" markerHeight="14" refX="12" refY="7" orient="auto">
        <circle cx="5" cy="7" r="3" stroke="#60a5fa" fill="none" stroke-width="1.5"/>
        <line x1="10" y1="1" x2="10" y2="13" stroke="#60a5fa" stroke-width="2"/>
      </marker>
      <!-- |{ one-or-more: bar (min) + crow's foot (max) -->
      <marker id="er-e-one-more" markerWidth="16" markerHeight="14" refX="15" refY="7" orient="auto">
        <line x1="2" y1="1" x2="2" y2="13" stroke="#60a5fa" stroke-width="2"/>
        <path d="M 7,7 L 14,1 M 7,7 L 14,7 M 7,7 L 14,13" stroke="#60a5fa" stroke-width="1.5" fill="none"/>
      </marker>
      <!-- o{ zero-or-more: circle (min) + crow's foot (max) -->
      <marker id="er-e-zero-more" markerWidth="19" markerHeight="14" refX="18" refY="7" orient="auto">
        <circle cx="4" cy="7" r="3" stroke="#60a5fa" fill="none" stroke-width="1.5"/>
        <path d="M 10,7 L 17,1 M 10,7 L 17,7 M 10,7 L 17,13" stroke="#60a5fa" stroke-width="1.5" fill="none"/>
      </marker>
    </defs>

    <!-- ── background: catches all clicks on empty canvas (must be before nodes/edges) ── -->
    <rect
      x="0" y="0" width="100%" height="100%"
      fill="transparent"
      @mousedown="onBgMousedown"
    />

    <!-- ── edges ── -->
    <g
      v-for="edge in edges"
      :key="'edge-' + edge.id"
      class="cursor-pointer"
      @mousedown.stop="onEdgeClick($event, edge)"
      @dblclick.stop="startEdgeEdit(edge)"
      @contextmenu.prevent.stop="onEdgeContextMenu($event, edge)"
    >
      <path
        :d="edgePath(edge)"
        fill="none"
        :stroke="selectedEdgeId === edge.id ? '#f59e0b' : '#60a5fa'"
        stroke-width="2"
        :stroke-dasharray="edgeStrokeDasharray(edge.edgeType)"
        :marker-start="edgeMarkerStart(edge)"
        :marker-end="edgeMarkerEnd(edge)"
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
      <!-- process / participant / class → plain rect -->
      <template v-if="['process','participant','class'].includes(node.type)">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- entity → expandable rect with attribute rows -->
      <template v-if="node.type === 'entity'">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="entityHeight(node)"
          :fill="nodeColor('entity').fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <!-- header/body divider -->
        <line
          v-if="node.attributes?.length"
          :x1="effectiveX(node) - NODE_W / 2" :y1="effectiveY(node) + NODE_H / 2"
          :x2="effectiveX(node) + NODE_W / 2" :y2="effectiveY(node) + NODE_H / 2"
          :stroke="nodeColor('entity').stroke" stroke-width="1" opacity="0.5"
        />
        <!-- attribute rows -->
        <g
          v-for="(attr, i) in (node.attributes || [])"
          :key="'attr-' + i"
          @mousedown.stop="onAttrRowMousedown($event, node.id, i)"
          style="cursor:default"
        >
          <rect
            :x="effectiveX(node) - NODE_W / 2"
            :y="effectiveY(node) + NODE_H / 2 + i * 20"
            :width="NODE_W" height="20"
            :fill="mode === 'delete' ? 'rgba(248,113,113,0.12)' : 'transparent'"
            style="cursor:pointer"
          />
          <text
            :x="effectiveX(node) - NODE_W / 2 + 6"
            :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
            fill="#5eead4" font-size="10" text-anchor="start" pointer-events="none"
          >{{ attr.dataType }}</text>
          <text
            :x="effectiveX(node) - NODE_W / 2 + 56"
            :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
            fill="#e2e8f0" font-size="10" text-anchor="start" pointer-events="none"
          >{{ attr.name }}</text>
          <text
            v-if="mode === 'delete'"
            :x="effectiveX(node) + NODE_W / 2 - 8"
            :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
            fill="#f87171" font-size="11" text-anchor="middle" pointer-events="none"
          >×</text>
        </g>
        <!-- "+ attr" button (select mode, selected, not currently adding) -->
        <g
          v-if="mode === 'select' && selectedId === node.id && addingAttrNodeId !== node.id"
          @mousedown.stop="startAddAttr(node, $event)"
          style="cursor:pointer"
        >
          <rect
            :x="effectiveX(node) - 20"
            :y="effectiveY(node) - NODE_H / 2 + entityHeight(node) + 3"
            width="40" height="14" rx="2"
            fill="#0f766e" opacity="0.85"
          />
          <text
            :x="effectiveX(node)"
            :y="effectiveY(node) - NODE_H / 2 + entityHeight(node) + 13"
            fill="#ccfbf1" font-size="9" text-anchor="middle" pointer-events="none"
          >+ attr</text>
        </g>
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

    <!-- ── inline attribute add form ── -->
    <foreignObject
      v-if="addingAttrNodeId !== null"
      :x="(() => { const n = nodes.find(n => n.id === addingAttrNodeId); return n ? effectiveX(n) - NODE_W / 2 : 0 })()"
      :y="(() => { const n = nodes.find(n => n.id === addingAttrNodeId); return n ? effectiveY(n) - NODE_H / 2 + entityHeight(n) + 20 : 0 })()"
      width="210" height="28"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;gap:3px;height:100%">
        <input
          ref="newAttrTypeInputRef"
          v-model="newAttrType"
          placeholder="type"
          @keydown.enter.stop="commitAddAttr"
          @keydown.tab.prevent="newAttrNameInputRef?.focus()"
          @keydown.escape.stop="addingAttrNodeId = null"
          style="width:64px;background:#0f172a;color:#5eead4;border:1px solid #2dd4bf;font-size:11px;padding:2px 4px;outline:none;box-sizing:border-box;"
        />
        <input
          ref="newAttrNameInputRef"
          v-model="newAttrName"
          placeholder="name"
          @keydown.enter.stop="commitAddAttr"
          @keydown.escape.stop="addingAttrNodeId = null"
          style="width:96px;background:#0f172a;color:#e2e8f0;border:1px solid #2dd4bf;font-size:11px;padding:2px 4px;outline:none;box-sizing:border-box;"
        />
        <button
          @mousedown.prevent.stop="commitAddAttr"
          style="background:#0f766e;color:#ccfbf1;border:none;font-size:11px;padding:2px 7px;cursor:pointer;border-radius:2px;"
        >✓</button>
      </div>
    </foreignObject>

    <!-- ── inline edge label editor ── -->
    <foreignObject
      v-if="editingEdge"
      :x="edgeMidpoint(editingEdge).x - 70"
      :y="edgeMidpoint(editingEdge).y - 2"
      width="140"
      height="26"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
        <input
          ref="editEdgeInputRef"
          v-model="editEdgeLabel"
          @keydown.enter.stop="commitEdgeEdit"
          @keydown.escape.stop="editingEdgeId = null"
          @blur="commitEdgeEdit"
          style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #818cf8;font-size:12px;text-align:center;padding:2px 4px;box-sizing:border-box;outline:none;border-radius:3px;"
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

  <!-- ── ER relation cardinality context menu ── -->
  <div
    v-if="ctxEdgeId !== null"
    :style="{ position: 'absolute', left: ctxX + 'px', top: ctxY + 'px', zIndex: 50 }"
    class="bg-gray-800 border border-gray-600 rounded shadow-xl py-1 w-52 text-sm"
    @mousedown.stop
  >
    <!-- From side -->
    <div class="px-3 py-1 text-xs text-teal-400 font-semibold tracking-wide">
      From: {{ ctxFromNode?.label ?? '?' }}
    </div>
    <div
      v-for="opt in ER_FROM_CARDS"
      :key="'f-' + opt.value"
      :class="[
        'flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors',
        ctxParsed.left === opt.value ? 'bg-indigo-700 text-white' : 'text-gray-200 hover:bg-gray-700'
      ]"
      @mousedown.stop="selectFromCard(opt.value)"
    >
      <code class="w-6 text-center font-mono text-xs opacity-75">{{ opt.value }}</code>
      <span>{{ opt.label }}</span>
    </div>

    <div class="my-1 border-t border-gray-700" />

    <!-- To side -->
    <div class="px-3 py-1 text-xs text-teal-400 font-semibold tracking-wide">
      To: {{ ctxToNode?.label ?? '?' }}
    </div>
    <div
      v-for="opt in ER_TO_CARDS"
      :key="'t-' + opt.value"
      :class="[
        'flex items-center gap-2 px-3 py-1 cursor-pointer transition-colors',
        ctxParsed.right === opt.value ? 'bg-indigo-700 text-white' : 'text-gray-200 hover:bg-gray-700'
      ]"
      @mousedown.stop="selectToCard(opt.value)"
    >
      <code class="w-6 text-center font-mono text-xs opacity-75">{{ opt.value }}</code>
      <span>{{ opt.label }}</span>
    </div>
  </div>

  <!-- slot insert context menu -->
  <div
    v-if="slotCtxVisible"
    class="absolute z-50 overflow-hidden rounded shadow-xl border border-gray-600 text-xs"
    style="background:#1e293b; min-width:120px"
    :style="{ left: slotCtxX + 'px', top: slotCtxY + 'px' }"
    @mousedown.stop
  >
    <div class="px-3 py-1.5 text-gray-400 border-b border-gray-700 select-none">
      Slot {{ slotCtxSlot + 1 }}
    </div>
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-gray-200 hover:bg-gray-700 transition-colors"
      @mousedown.stop="slotInsert('above')"
    >↑ 위에 추가</button>
    <button
      class="flex w-full items-center gap-2 px-3 py-2 text-gray-200 hover:bg-gray-700 transition-colors"
      @mousedown.stop="slotInsert('below')"
    >↓ 아래에 추가</button>
  </div>

  </div>
</template>
