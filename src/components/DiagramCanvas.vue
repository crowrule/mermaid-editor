<script setup>
import { ref, computed, nextTick, watch, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  nodes:       { type: Array, required: true },
  edges:       { type: Array, required: true },
  activations: { type: Array, default: () => [] },
  regions:     { type: Array, default: () => [] },
  subgraphs:   { type: Array, default: () => [] },
  diagramType:      { type: String, required: true },
  mode:             { type: String, default: 'select' },
  selectedNodeType: { type: String, default: 'process' },
  selectedEdgeType: { type: String, default: 'arrow' },
  seqFlowCount:   { type: Number, default: 10 },
  seqFlowSpacing: { type: Number, default: 50 },
  lang:           { type: String, default: 'en' },
})

const emit = defineEmits([
  'add-node', 'move-node', 'add-edge',
  'delete-node', 'delete-edge', 'update-node-label', 'update-edge-label',
  'add-attribute', 'delete-attribute', 'update-edge-type',
  'add-member', 'update-member', 'delete-member',
  'add-activation', 'delete-activation',
  'insert-slot',
  'add-region', 'update-region', 'delete-region',
  'add-subgraph', 'update-subgraph', 'delete-subgraph',
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

// ── class diagram relation types ──────────────────────────────────────────────
const CLASS_RELATIONS = [
  { type: 'inherit',     label: 'Inheritance',   symbol: '<|--' },
  { type: 'realize',     label: 'Realization',   symbol: '..|>' },
  { type: 'compose',     label: 'Composition',   symbol: '*--'  },
  { type: 'aggregate',   label: 'Aggregation',   symbol: 'o--'  },
  { type: 'assoc',       label: 'Association',   symbol: '-->'  },
  { type: 'dependent',   label: 'Dependency',    symbol: '..>'  },
  { type: 'link-solid',  label: 'Link (Solid)',  symbol: '--'   },
  { type: 'link-dashed', label: 'Link (Dashed)', symbol: '..'   },
]

// ── region types ─────────────────────────────────────────────────────────────
const REGION_TYPES = [
  { type: 'rect',     label: 'rect',     fill: '#042f2e', stroke: '#2dd4bf' },
  { type: 'alt',      label: 'alt',      fill: '#2e1065', stroke: '#a78bfa' },
  { type: 'par',      label: 'par',      fill: '#1e3a8a', stroke: '#60a5fa' },
  { type: 'critical', label: 'critical', fill: '#7f1d1d', stroke: '#f87171' },
  { type: 'break',    label: 'break',    fill: '#431407', stroke: '#fb923c' },
  { type: 'opt',      label: 'opt',      fill: '#14532d', stroke: '#4ade80' },
  { type: 'loop',     label: 'loop',     fill: '#164e63', stroke: '#22d3ee' },
]
// Brighter inner-region colors (used when depth > 0)
const REGION_INNER_COLORS = {
  rect:     { fill: '#0f766e', stroke: '#5eead4' },
  alt:      { fill: '#4c1d95', stroke: '#d8b4fe' },
  par:      { fill: '#1d4ed8', stroke: '#93c5fd' },
  critical: { fill: '#b91c1c', stroke: '#fca5a5' },
  break:    { fill: '#c2410c', stroke: '#fdba74' },
  opt:      { fill: '#15803d', stroke: '#86efac' },
  loop:     { fill: '#0e7490', stroke: '#67e8f9' },
}
const REGION_INDENT = 14   // px indented per nesting depth (each side)

function regionTypeInfo(type) {
  return REGION_TYPES.find(r => r.type === type) ?? REGION_TYPES[0]
}

// depth: how many other regions fully contain this one
const regionDepths = computed(() => {
  const map = new Map()
  for (const r of props.regions) {
    let depth = 0
    for (const other of props.regions) {
      if (other.id !== r.id &&
          other.startSlot <= r.startSlot &&
          r.endSlot <= other.endSlot) depth++
    }
    map.set(r.id, depth)
  }
  return map
})

// returns fill/stroke for a region based on its nesting depth
function regionStyle(region) {
  const depth = regionDepths.value.get(region.id) ?? 0
  if (depth === 0) return regionTypeInfo(region.type)
  const inner = REGION_INNER_COLORS[region.type]
  return inner ?? regionTypeInfo(region.type)
}

// returns layout {left, right, width} for a region based on nesting depth
function rLayout(region) {
  const depth = regionDepths.value.get(region.id) ?? 0
  const dx    = depth * REGION_INDENT
  const left  = 10 + dx
  const right = seqBodyWidth.value - 10 - dx
  return { left, right, width: right - left }
}

// ── constants ────────────────────────────────────────────────────────────────
const NODE_W = 120
const NODE_H = 48
const SEQ_PARTICIPANT_SPACING = 160
const SEQ_OFFSET_X = 100
const SEQ_LIFELINE_TOP = 80
const SEQ_MESSAGE_START_Y = 110
// SEQ_MESSAGE_SPACING removed — now driven by seqFlowSpacing prop
const SEQ_BODY_PADDING    = 20   // vertical padding at top of scrollable body SVG
const REGION_LABEL_MARGIN = 170  // right-side label column width

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
  // Floating menus close on any click outside themselves
  // (each menu has @mousedown.stop, so internal clicks never reach here)
  regionMenu.value     = null
  dividerCtxMenu.value = null
  regionCtxMenu.value  = null
  if (containerRef.value && !containerRef.value.contains(e.target)) {
    ctxEdgeId.value = null
    slotCtxVisible.value = false
  }
}
function onGlobalMousemove(e) {
  if (!svgRef.value) return
  const rect = svgRef.value.getBoundingClientRect()
  const y = e.clientY - rect.top

  // divider line drag
  if (draggingDivId.value !== null) {
    if (!dividerDragStarted) {
      if (Math.abs(e.clientY - dividerDragStartY) > 8) {
        dividerDragStarted   = true
        dividerCtxMenu.value = null   // hide menu once dragging begins
      } else return
    }
    const region = props.regions.find(r => r.id === draggingDivRegId.value)
    if (region) {
      const slot   = Math.round((y - SEQ_BODY_PADDING) / props.seqFlowSpacing)
      const dividers = [...(region.dividers || [])].sort((a, b) => a.slot - b.slot)
      const divIdx   = dividers.findIndex(d => d.id === draggingDivId.value)
      const minSlot  = divIdx > 0 ? dividers[divIdx - 1].slot + 1 : region.startSlot + 1
      const maxSlot  = divIdx < dividers.length - 1 ? dividers[divIdx + 1].slot - 1 : props.seqFlowCount - 1
      divDragPreviewSlot.value = Math.max(minSlot, Math.min(slot, maxSlot))
    }
    return
  }

  // resize handle drag
  if (resizingRegionId.value !== null) {
    const slot = Math.max(0, Math.round((y - SEQ_BODY_PADDING) / props.seqFlowSpacing))
    const region = props.regions.find(r => r.id === resizingRegionId.value)
    if (region) {
      resizePreviewEndSlot.value = Math.max(region.startSlot, Math.min(slot, props.seqFlowCount - 1))
    }
    return
  }

  // new region drag
  if (regionDragStartSlot < 0) return
  if (!regionDragStarted) {
    if (Math.abs(e.clientY - regionDragStartY) > 8) regionDragStarted = true
    else return
  }
  const currentSlot = Math.max(0, Math.round((y - SEQ_BODY_PADDING) / props.seqFlowSpacing))
  const startSlot = Math.min(regionDragStartSlot, currentSlot)
  const endSlot   = Math.max(regionDragStartSlot, currentSlot)
  regionDragPreview.value = { startSlot, endSlot }
}

function onGlobalMouseup(e) {
  // commit divider drag
  if (draggingDivId.value !== null) {
    if (dividerDragStarted) {
      const region = props.regions.find(r => r.id === draggingDivRegId.value)
      if (region && divDragPreviewSlot.value !== null) {
        const newSlot  = divDragPreviewSlot.value
        const updates  = {
          dividers: (region.dividers || []).map(d =>
            d.id === draggingDivId.value ? { ...d, slot: newSlot } : d
          ),
        }
        if (newSlot >= region.endSlot) updates.endSlot = newSlot
        emit('update-region', region.id, updates)
      }
    }
    // always reset drag state; menu stays open if no drag occurred
    draggingDivId.value      = null
    draggingDivRegId.value   = null
    divDragPreviewSlot.value = null
    dividerDragStarted       = false
    return
  }

  // commit resize
  if (resizingRegionId.value !== null) {
    if (resizePreviewEndSlot.value !== null) {
      emit('update-region', resizingRegionId.value, { endSlot: resizePreviewEndSlot.value })
    }
    resizingRegionId.value     = null
    resizePreviewEndSlot.value = null
    return
  }

  // commit new region drag
  if (regionDragStartSlot < 0) return
  if (regionDragStarted && regionDragPreview.value) {
    const { startSlot, endSlot } = regionDragPreview.value
    const rect = containerRef.value.getBoundingClientRect()
    regionMenu.value = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      startSlot,
      endSlot,
      targetRegionId: null,
    }
  }
  regionDragPreview.value = null
  regionDragStartSlot = -1
  regionDragStartY    = 0
  regionDragStarted   = false
}

onMounted(() => {
  document.addEventListener('mousedown', onDocMousedown)
  document.addEventListener('mousemove', onGlobalMousemove)
  document.addEventListener('mouseup',   onGlobalMouseup)
})
onUnmounted(() => {
  document.removeEventListener('mousedown', onDocMousedown)
  document.removeEventListener('mousemove', onGlobalMousemove)
  document.removeEventListener('mouseup',   onGlobalMouseup)
})
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

// inline add member (class diagram)
const addingMemberNodeId  = ref(null)
const newMemberIsMethod   = ref(false)
const newMemberVis        = ref('+')
const newMemberType       = ref('String')
const newMemberName       = ref('')
const newMemberTypeInputRef = ref(null)
const newMemberNameInputRef = ref(null)

// inline edit member (class diagram)
const editingMemberNodeId    = ref(null)
const editingMemberIndex     = ref(null)
const editMemberIsMethod     = ref(false)
const editMemberVis          = ref('+')
const editMemberType         = ref('')
const editMemberName         = ref('')
const editMemberTypeInputRef = ref(null)
const editMemberNameInputRef = ref(null)

// inline edit — edge
const editingEdgeId = ref(null)
const editEdgeLabel = ref('')
const editEdgeInputRef = ref(null)

// ── region drag + menu state ──────────────────────────────────────────────────
const regionDragPreview  = ref(null)   // { startSlot, endSlot } while dragging
const regionMenu         = ref(null)   // { x, y, startSlot, endSlot, targetRegionId }
const editingRegionId    = ref(null)
const editRegionLabel    = ref('')
const editRegionLabelRef = ref(null)
let regionDragStartSlot  = -1
let regionDragStartY     = 0
let regionDragStarted    = false

// ── region resize state ───────────────────────────────────────────────────────
const resizingRegionId     = ref(null)
const resizePreviewEndSlot = ref(null)

// ── region divider edit state ─────────────────────────────────────────────────
const editingDividerId    = ref(null)
const editingDivRegionId  = ref(null)
const editDividerLabel    = ref('')
const editDividerLabelRef = ref(null)

// ── region divider drag state ─────────────────────────────────────────────────
const draggingDivId      = ref(null)
const draggingDivRegId   = ref(null)
const divDragPreviewSlot = ref(null)
let   dividerDragStartY      = 0
let   dividerDragStarted     = false

// ── region divider context menu ───────────────────────────────────────────────
const dividerCtxMenu = ref(null)  // { x, y, divId, regionId }
const regionCtxMenu  = ref(null)  // { x, y, regionId }

// ── subgraph (flowchart only) ─────────────────────────────────────────────────
const selectedSgId    = ref(null)
const editingSgId     = ref(null)
const editSgLabel     = ref('')
const editSgLabelRef  = ref(null)
const sgDragPreview   = ref(null)  // { x, y, width, height } during draw
let   sgDragStart     = null       // { x, y } anchor point

const currentMenuRegion = computed(() =>
  regionMenu.value?.targetRegionId != null
    ? props.regions.find(r => r.id === regionMenu.value.targetRegionId) ?? null
    : null
)
const editingEdge = computed(() =>
  editingEdgeId.value !== null
    ? props.edges.find(e => e.id === editingEdgeId.value) ?? null
    : null
)
// If the edge being edited disappears (e.g. deleted), cancel the edit
watch(editingEdge, (e) => { if (editingEdgeId.value !== null && !e) editingEdgeId.value = null })

// Reset all transient UI state when diagram type changes
watch(() => props.diagramType, () => {
  selectedId.value        = null
  selectedEdgeId.value    = null
  selectedSgId.value      = null
  editingNodeId.value     = null
  editingEdgeId.value     = null
  editingSgId.value       = null
  addingAttrNodeId.value   = null
  addingMemberNodeId.value  = null
  editingMemberNodeId.value = null
  editingMemberIndex.value  = null
  connectSource.value       = null
  ctxEdgeId.value          = null
  regionMenu.value         = null
  sgDragStart              = null
  sgDragPreview.value      = null
})

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

// ── class member helpers ──────────────────────────────────────────────────────
function classNodeHeight(node) {
  return NODE_H + (node.members?.length || 0) * 20
}
// Geometric center of the full class box (shifted down when members exist)
function classNodeCenter(node) {
  return { x: node.x, y: node.y + (node.members?.length || 0) * 10 }
}

// ── empty state hints ─────────────────────────────────────────────────────────
const REGION_MENU_I18N = {
  en: { changeType: 'Change Type', selectType: 'Select Region Type', delete: 'Delete' },
  es: { changeType: 'Cambiar tipo', selectType: 'Seleccionar tipo',  delete: 'Eliminar' },
  ko: { changeType: '타입 변경',    selectType: '구역 타입 선택',     delete: '삭제' },
}
const regionMenuI18n = computed(() => REGION_MENU_I18N[props.lang] ?? REGION_MENU_I18N.en)

const EMPTY_HINTS = {
  en: {
    seq:    'In Add mode, click to add Participant / Actor',
    other:  'Select a node type and click "Add" mode, then click here to place nodes',
  },
  es: {
    seq:    'En modo Add, haz clic para añadir Participant / Actor',
    other:  'Selecciona un tipo de nodo, activa el modo "Add" y haz clic aquí',
  },
  ko: {
    seq:    'Add 모드에서 클릭해서 Participant / Actor 추가',
    other:  '노드 유형을 선택하고 Add 모드에서 클릭해서 배치',
  },
}
const emptyHint = computed(() => {
  const h = EMPTY_HINTS[props.lang] ?? EMPTY_HINTS.en
  return props.diagramType === 'sequence' ? h.seq : h.other
})

// ── sequence layout helpers ───────────────────────────────────────────────────
const isSequence  = computed(() => props.diagramType === 'sequence')
// Only flowchart and class diagram support grouping (subgraph / namespace)
const isGroupable = computed(() => props.diagramType === 'flowchart' || props.diagramType === 'class')

// Visual style for subgraph (flowchart) vs namespace (class diagram)
const sgStyle = computed(() => {
  if (props.diagramType === 'class') {
    return {
      fill:        'rgba(16,185,129,0.08)',
      stroke:      '#10b981',
      badgeFill:   '#065f46',
      textFill:    '#6ee7b7',
      editorStyle: 'width:100%;height:100%;background:#022c22;color:#6ee7b7;border:1px solid #10b981;font-size:11px;padding:1px 4px;box-sizing:border-box;outline:none;border-radius:2px;',
      defaultLabel: 'namespace',
      previewFill:  'rgba(16,185,129,0.07)',
    }
  }
  return {
    fill:        'rgba(99,102,241,0.1)',
    stroke:      '#6366f1',
    badgeFill:   '#4338ca',
    textFill:    '#c7d2fe',
    editorStyle: 'width:100%;height:100%;background:#1e1b4b;color:#c7d2fe;border:1px solid #818cf8;font-size:11px;padding:1px 4px;box-sizing:border-box;outline:none;border-radius:2px;',
    defaultLabel: 'subgraph',
    previewFill:  'rgba(99,102,241,0.07)',
  }
})

// Height of the scrollable body SVG
const seqBodyHeight = computed(() =>
  SEQ_BODY_PADDING + props.seqFlowCount * props.seqFlowSpacing + 40
)
// Minimum canvas width = 2 participants wide
const SEQ_MIN_CANVAS_WIDTH = SEQ_OFFSET_X + SEQ_PARTICIPANT_SPACING + NODE_W / 2 + 40  // 400px
// Participant / message drawing area width
const seqBodyWidth = computed(() => {
  const n = props.nodes.length
  const natural = SEQ_OFFSET_X + Math.max(n - 1, 0) * SEQ_PARTICIPANT_SPACING + NODE_W / 2 + 40
  return Math.max(natural, SEQ_MIN_CANVAS_WIDTH)
})
// Total SVG width: adds right column for region labels when regions exist
const seqCanvasWidth = computed(() =>
  seqBodyWidth.value + (props.regions.length > 0 ? REGION_LABEL_MARGIN : 0)
)

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

// Boundary point for flowchart node shapes in direction (ux, uy) from node center
function fcNodeBoundaryPoint(node, ux, uy) {
  const hw = NODE_W / 2, hh = NODE_H / 2
  if (node.type === 'reference') {
    // circle: radius = NODE_H / 2
    return { x: node.x + hh * ux, y: node.y + hh * uy }
  }
  if (node.type === 'decision') {
    // diamond: |x/hw| + |y/hh| = 1
    const denom = Math.abs(ux) / hw + Math.abs(uy) / hh
    if (denom < 0.0001) return { x: node.x, y: node.y }
    const t = 1 / denom
    return { x: node.x + t * ux, y: node.y + t * uy }
  }
  // rectangle family: process, terminal, subprocess, io, database, multiprocess, class
  return entityBoundaryPoint(node.x, node.y, ux, uy)
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
  // Class: path using geometric center of expanded class box (accounts for members)
  if (props.diagramType === 'class') {
    const fc = classNodeCenter(fromNode)
    const tc = classNodeCenter(toNode)
    const dx = tc.x - fc.x, dy = tc.y - fc.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const ux = dx / len, uy = dy / len
    const fp = entityBoundaryPoint(fc.x, fc.y,  ux,  uy, NODE_W / 2, classNodeHeight(fromNode) / 2)
    const tp = entityBoundaryPoint(tc.x, tc.y, -ux, -uy, NODE_W / 2, classNodeHeight(toNode)   / 2)
    return `M${fp.x},${fp.y} L${tp.x},${tp.y}`
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
  // Flowchart: clip path at each node's boundary so arrowhead is visible
  const dx = toNode.x - fromNode.x
  const dy = toNode.y - fromNode.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const ux = dx / len, uy = dy / len
  const fp = fcNodeBoundaryPoint(fromNode,  ux,  uy)
  const tp = fcNodeBoundaryPoint(toNode,   -ux, -uy)
  return `M${fp.x},${fp.y} L${tp.x},${tp.y}`
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
  if (props.diagramType === 'class') {
    return ['dependent', 'realize', 'link-dashed'].includes(edgeType) ? '6 4' : 'none'
  }
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
  if (props.diagramType === 'class') {
    const sel = selectedEdgeId.value === edge.id
    switch (edge.edgeType) {
      case 'inherit':   return sel ? 'url(#cls-inh-sel)'  : 'url(#cls-inh)'
      case 'compose':   return sel ? 'url(#cls-cmp-sel)'  : 'url(#cls-cmp)'
      case 'aggregate': return sel ? 'url(#cls-agg-sel)'  : 'url(#cls-agg)'
      default:          return ''
    }
  }
  if (props.diagramType !== 'er') return ''
  const { left } = parseERSides(edge.edgeType)
  return ER_START_MARKER[left] ?? 'url(#er-s-exact-one)'
}

function edgeMarkerEnd(edge) {
  if (props.diagramType === 'class') {
    const sel = selectedEdgeId.value === edge.id
    switch (edge.edgeType) {
      case 'inherit':
      case 'compose':
      case 'aggregate':
      case 'link-solid':
      case 'link-dashed': return ''
      case 'realize':     return sel ? 'url(#cls-rlz-sel)' : 'url(#cls-rlz)'
      default:            return sel ? 'url(#arrowHeadSel)' : 'url(#arrowHead)'  // assoc, dependent
    }
  }
  if (props.diagramType !== 'er') {
    if (edge.edgeType === 'open') return ''
    if (edge.edgeType === 'cross') return 'url(#arrowCross)'
    return selectedEdgeId.value === edge.id ? 'url(#arrowHeadSel)' : 'url(#arrowHead)'
  }
  const { right } = parseERSides(edge.edgeType)
  return ER_END_MARKER[right] ?? 'url(#er-e-zero-more)'
}

// ── mouse handlers ────────────────────────────────────────────────────────────

// Called when the transparent background rect is clicked (guarantees background-only hit)
function onBgMousedown(e) {
  selectedId.value = null
  selectedEdgeId.value = null
  selectedSgId.value = null
  connectSource.value = null
  addingAttrNodeId.value = null
  addingMemberNodeId.value = null
  ctxEdgeId.value = null
  slotCtxVisible.value = false
  regionMenu.value = null

  // Sequence + select: start region drag
  if (isSequence.value && props.mode === 'select') {
    const rect = svgRef.value.getBoundingClientRect()
    const y = e.clientY - rect.top
    regionDragStartSlot = Math.round((y - SEQ_BODY_PADDING) / props.seqFlowSpacing)
    regionDragStartY    = e.clientY
    regionDragStarted   = false
    return
  }

  // Flowchart/Class select: start subgraph/namespace drag-to-draw
  if (isGroupable.value && props.mode === 'select') {
    const pt = svgPoint(e)
    sgDragStart = { x: pt.x, y: pt.y }
    return
  }

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
  selectedSgId.value = null
  if (addingAttrNodeId.value !== null && addingAttrNodeId.value !== node.id)
    addingAttrNodeId.value = null
  if (addingMemberNodeId.value !== null && addingMemberNodeId.value !== node.id)
    addingMemberNodeId.value = null

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
  if (props.diagramType !== 'er' && props.diagramType !== 'class') return
  const rect = containerRef.value.getBoundingClientRect()
  ctxX.value = e.clientX - rect.left
  ctxY.value = e.clientY - rect.top
  ctxEdgeId.value = edge.id
}

const CLASS_RELATION_LABELS = {
  'inherit':     'Inheritance',
  'realize':     'Realization',
  'compose':     'Composition',
  'aggregate':   'Aggregation',
  'assoc':       'Association',
  'dependent':   'Dependency',
  'link-solid':  'Link (Solid)',
  'link-dashed': 'Link (Dashed)',
}

function selectClassRelation(type) {
  if (ctxEdgeId.value !== null) {
    emit('update-edge-type', ctxEdgeId.value, type)
    emit('update-edge-label', ctxEdgeId.value, CLASS_RELATION_LABELS[type] ?? '')
  }
  ctxEdgeId.value = null
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
  addingMemberNodeId.value = null
  selectedSgId.value = null
  if (props.mode === 'delete') {
    emit('delete-edge', edge.id)
    return
  }
  selectedEdgeId.value = edge.id
  selectedId.value = null
}

function onMouseMove(e) {
  // Subgraph drag-to-draw preview
  if (sgDragStart) {
    const pt = svgPoint(e)
    const x = Math.min(sgDragStart.x, pt.x)
    const y = Math.min(sgDragStart.y, pt.y)
    sgDragPreview.value = { x, y, width: Math.abs(pt.x - sgDragStart.x), height: Math.abs(pt.y - sgDragStart.y) }
    return
  }
  if (!dragging) return
  const pt = svgPoint(e)
  emit('move-node', dragging.id, pt.x - dragOffX, pt.y - dragOffY)
}

function onMouseUp() {
  // Finalize subgraph creation
  if (sgDragStart) {
    const prev = sgDragPreview.value
    if (prev && prev.width > 40 && prev.height > 40) {
      emit('add-subgraph', prev.x, prev.y, prev.width, prev.height)
    }
    sgDragStart = null
    sgDragPreview.value = null
    return
  }
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

function startAddMember(node, e) {
  e?.stopPropagation()
  addingMemberNodeId.value = node.id
  newMemberIsMethod.value  = false
  newMemberVis.value  = '+'
  newMemberType.value = 'String'
  newMemberName.value = 'name'
  nextTick(() => newMemberTypeInputRef.value?.focus())
}

function toggleMemberKind() {
  newMemberIsMethod.value = !newMemberIsMethod.value
  newMemberType.value = newMemberIsMethod.value ? 'void' : 'String'
  newMemberName.value = newMemberIsMethod.value ? 'method()' : 'name'
  nextTick(() => newMemberTypeInputRef.value?.focus())
}

function commitAddMember() {
  if (addingMemberNodeId.value !== null) {
    let name = newMemberName.value.trim()
    const type = newMemberType.value.trim() || (newMemberIsMethod.value ? 'void' : 'String')
    const vis  = newMemberVis.value
    if (name) {
      // Auto-add () for methods if not already present
      if (newMemberIsMethod.value && !name.includes('(')) name += '()'
      emit('add-member', addingMemberNodeId.value, vis, type, name)
    }
    addingMemberNodeId.value = null
  }
}

function onMemberRowMousedown(e, nodeId, index) {
  if (props.mode === 'delete') emit('delete-member', nodeId, index)
}

function startEditMember(node, index, member, e) {
  e?.stopPropagation()
  if (props.mode === 'delete' || props.mode === 'connect') return
  editingMemberNodeId.value = node.id
  editingMemberIndex.value  = index
  editMemberIsMethod.value  = member.name.includes('(')
  editMemberVis.value       = member.visibility
  editMemberType.value      = member.type
  editMemberName.value      = member.name
  nextTick(() => editMemberTypeInputRef.value?.focus())
}

function commitEditMember() {
  if (editingMemberNodeId.value !== null && editingMemberIndex.value !== null) {
    let name = editMemberName.value.trim()
    const type = editMemberType.value.trim() || (editMemberIsMethod.value ? 'void' : 'String')
    const vis  = editMemberVis.value
    if (name) {
      if (editMemberIsMethod.value && !name.includes('(')) name += '()'
      emit('update-member', editingMemberNodeId.value, editingMemberIndex.value, vis, type, name)
    }
  }
  editingMemberNodeId.value = null
  editingMemberIndex.value  = null
}

function toggleEditMemberKind() {
  editMemberIsMethod.value = !editMemberIsMethod.value
  nextTick(() => editMemberTypeInputRef.value?.focus())
}

function commitEdgeEdit() {
  if (editingEdgeId.value !== null) {
    emit('update-edge-label', editingEdgeId.value, editEdgeLabel.value)
    editingEdgeId.value = null
  }
}

function seqEdgeLabel(edge) {
  return edge.label || (edge.slot !== undefined ? `msg-${edge.slot + 1}` : 'message')
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

// ── region functions ──────────────────────────────────────────────────────────
function onRegionMenuDelete() {
  if (!regionMenu.value?.targetRegionId) return
  emit('delete-region', regionMenu.value.targetRegionId)
  regionMenu.value = null
}

function onRegionMenuSelect(type) {
  if (!regionMenu.value) return
  if (regionMenu.value.targetRegionId !== null) {
    emit('update-region', regionMenu.value.targetRegionId, { type })
  } else {
    emit('add-region', regionMenu.value.startSlot, regionMenu.value.endSlot, type, '')
  }
  regionMenu.value = null
}

function onRegionTypeClick(region, e) {
  e.stopPropagation()
  if (props.mode === 'delete') return
  const rect = containerRef.value.getBoundingClientRect()
  regionMenu.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    startSlot:      region.startSlot,
    endSlot:        region.endSlot,
    targetRegionId: region.id,
  }
}

function onRegionClick(region, e) {
  if (props.mode === 'delete') {
    e.stopPropagation()
    if (confirm('이 구역을 삭제하시겠습니까?')) {
      emit('delete-region', region.id)
    }
  }
}

function startRegionLabelEdit(region) {
  if (props.mode === 'delete') return
  editingRegionId.value = region.id
  editRegionLabel.value = region.label || ''
  nextTick(() => editRegionLabelRef.value?.focus())
}

function commitRegionLabel() {
  if (editingRegionId.value !== null) {
    emit('update-region', editingRegionId.value, { label: editRegionLabel.value })
    editingRegionId.value = null
  }
}

function regionY(region) {
  const raw = SEQ_BODY_PADDING + region.startSlot * props.seqFlowSpacing - props.seqFlowSpacing / 2
  return Math.max(0, raw)
}
function regionEffectiveEndSlot(region) {
  return (resizingRegionId.value === region.id && resizePreviewEndSlot.value !== null)
    ? resizePreviewEndSlot.value : region.endSlot
}
function regionHeight(region) {
  const bottom = SEQ_BODY_PADDING + (regionEffectiveEndSlot(region) + 1) * props.seqFlowSpacing - props.seqFlowSpacing / 2
  return bottom - regionY(region)
}
// Returns per-section layout info for rendering (main + each divider sub-section)
function sectionBounds(region) {
  const dividers = [...(region.dividers || [])].sort((a, b) => a.slot - b.slot)
  const totalBottom = regionY(region) + regionHeight(region)
  const sections = []
  const firstBottom = dividers.length > 0 ? dividerY(dividers[0]) : totalBottom
  sections.push({ topY: regionY(region), height: firstBottom - regionY(region), isMain: true, keyword: region.type, div: null })
  for (let i = 0; i < dividers.length; i++) {
    const div = dividers[i]
    const secTop    = dividerY(div)
    const secBottom = i < dividers.length - 1 ? dividerY(dividers[i + 1]) : totalBottom
    sections.push({ topY: secTop, height: secBottom - secTop, isMain: false, keyword: dividerKeyword(region.type), div })
  }
  return sections
}

function dividerKeyword(regionType) {
  if (regionType === 'alt')      return 'else'
  if (regionType === 'par')      return 'and'
  if (regionType === 'critical') return 'option'
  return ''
}
function dividerEffectiveSlot(div) {
  return (draggingDivId.value === div.id && divDragPreviewSlot.value !== null)
    ? divDragPreviewSlot.value : div.slot
}
function dividerY(div) {
  return SEQ_BODY_PADDING + dividerEffectiveSlot(div) * props.seqFlowSpacing - props.seqFlowSpacing / 2
}

// Line drag only — no menu
function onDividerMousedown(region, div, e) {
  e.stopPropagation()
  dividerCtxMenu.value     = null
  draggingDivId.value      = div.id
  draggingDivRegId.value   = region.id
  divDragPreviewSlot.value = div.slot
  dividerDragStartY        = e.clientY
  dividerDragStarted       = false
}

// Badge (keyword) click — show delete menu only, no drag
function onDividerBadgeMousedown(region, div, e) {
  e.stopPropagation()
  const rect = containerRef.value.getBoundingClientRect()
  dividerCtxMenu.value = {
    x: e.clientX - rect.left + 4,
    y: e.clientY - rect.top + 4,
    divId: div.id,
    regionId: region.id,
  }
}

function deleteDividerFromMenu() {
  if (!dividerCtxMenu.value) return
  const region = props.regions.find(r => r.id === dividerCtxMenu.value.regionId)
  if (region) {
    emit('update-region', region.id, {
      dividers: (region.dividers || []).filter(d => d.id !== dividerCtxMenu.value.divId),
    })
  }
  dividerCtxMenu.value = null
}

function onRegionDeleteBadgeMousedown(region, e) {
  e.stopPropagation()
  const rect = containerRef.value.getBoundingClientRect()
  regionCtxMenu.value = {
    x: e.clientX - rect.left + 4,
    y: e.clientY - rect.top + 4,
    regionId: region.id,
  }
}

function deleteRegionFromCtxMenu() {
  if (!regionCtxMenu.value) return
  emit('delete-region', regionCtxMenu.value.regionId)
  regionCtxMenu.value = null
}

function addDivider(region) {
  const dividers = [...(region.dividers || [])].sort((a, b) => a.slot - b.slot)
  const lastSlot = dividers.length ? dividers[dividers.length - 1].slot : region.startSlot
  let effectiveEnd = regionEffectiveEndSlot(region)

  // If there's no room between lastSlot and current endSlot, auto-extend the region
  if (lastSlot >= effectiveEnd) {
    effectiveEnd = Math.min(lastSlot + 1, props.seqFlowCount - 1)
  }

  const newSlot = Math.round((lastSlot + effectiveEnd + 1) / 2)
  const updates = {
    dividers: [...(region.dividers || []), { id: Date.now(), slot: newSlot, label: '' }],
  }
  if (effectiveEnd !== region.endSlot) updates.endSlot = effectiveEnd
  emit('update-region', region.id, updates)
  regionMenu.value = null
}

function deleteDivider(region, divId, e) {
  e?.stopPropagation()
  emit('update-region', region.id, {
    dividers: (region.dividers || []).filter(d => d.id !== divId),
  })
}

function startDividerLabelEdit(region, div, e) {
  e?.stopPropagation()
  if (props.mode === 'delete') return
  editingDividerId.value   = div.id
  editingDivRegionId.value = region.id
  editDividerLabel.value   = div.label || ''
  nextTick(() => editDividerLabelRef.value?.focus())
}

function commitDividerLabel() {
  if (editingDividerId.value === null) return
  const region = props.regions.find(r => r.id === editingDivRegionId.value)
  if (region) {
    emit('update-region', region.id, {
      dividers: (region.dividers || []).map(d =>
        d.id === editingDividerId.value ? { ...d, label: editDividerLabel.value } : d
      ),
    })
  }
  editingDividerId.value   = null
  editingDivRegionId.value = null
}

function onResizeHandleDown(region, e) {
  e.stopPropagation()
  regionCtxMenu.value        = null
  resizingRegionId.value     = region.id
  resizePreviewEndSlot.value = region.endSlot
}

// ── subgraph functions ────────────────────────────────────────────────────────
function onSgMousedown(e, sg) {
  e.stopPropagation()
  editingSgId.value = null
  if (props.mode === 'delete') {
    emit('delete-subgraph', sg.id)
    return
  }
  if (props.mode === 'select') {
    selectedSgId.value = sg.id
    selectedId.value   = null
    selectedEdgeId.value = null
  }
}

function startSgLabelEdit(sg) {
  if (props.mode === 'delete') return
  editingSgId.value = sg.id
  editSgLabel.value = sg.label
  nextTick(() => editSgLabelRef.value?.focus())
}

function commitSgLabel() {
  if (editingSgId.value === null) return
  emit('update-subgraph', editingSgId.value, { label: editSgLabel.value })
  editingSgId.value = null
}

// ── keyboard delete ───────────────────────────────────────────────────────────
function onKeyDown(e) {
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (editingNodeId.value !== null)   return
    if (editingEdgeId.value !== null)   return
    if (addingAttrNodeId.value !== null)  return
    if (addingMemberNodeId.value !== null) return
    if (editingSgId.value !== null)       return
    if (selectedSgId.value !== null) {
      emit('delete-subgraph', selectedSgId.value)
      selectedSgId.value = null
    } else if (selectedId.value !== null) {
      emit('delete-node', selectedId.value)
      selectedId.value = null
    } else if (selectedEdgeId.value !== null) {
      emit('delete-edge', selectedEdgeId.value)
      selectedEdgeId.value = null
    }
  }
  if (e.key === 'Escape') {
    connectSource.value       = null
    editingNodeId.value       = null
    editingEdgeId.value       = null
    editingSgId.value         = null
    selectedSgId.value        = null
    sgDragStart               = null
    sgDragPreview.value       = null
    editingRegionId.value     = null
    editingDividerId.value    = null
    draggingDivId.value       = null
    draggingDivRegId.value    = null
    divDragPreviewSlot.value  = null
    dividerCtxMenu.value      = null
    addingAttrNodeId.value     = null
    addingMemberNodeId.value   = null
    editingMemberNodeId.value  = null
    editingMemberIndex.value   = null
    ctxEdgeId.value            = null
    regionMenu.value           = null
    resizingRegionId.value     = null
    resizePreviewEndSlot.value = null
  }
}
</script>

<template>
  <div ref="containerRef" class="w-full h-full flex flex-col overflow-hidden" style="position:relative">

  <!-- ── SEQUENCE: sticky header + scrollable body ───────────────────────────── -->
  <template v-if="isSequence">

    <!-- Single scroll container: sticky header + scrollable body -->
    <div class="flex-1 overflow-auto bg-gray-950"
         :style="{ cursor: mode === 'add' ? 'crosshair' : mode === 'delete' ? 'not-allowed' : 'default' }">
      <div :style="{ width: seqCanvasWidth + 'px', minWidth: '100%' }">

    <!-- Sticky participant header -->
    <div style="position:sticky;top:0;z-index:10;background:#030712"
         @mousedown="onHeaderMousedown">
      <svg ref="headerSvgRef" :width="seqCanvasWidth" :height="SEQ_MESSAGE_START_Y" style="display:block">
        <rect x="0" y="0" :width="seqCanvasWidth" :height="SEQ_MESSAGE_START_Y"
              fill="transparent" @mousedown.stop="onHeaderMousedown" />
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
              pointer-events="none">{{ emptyHint }}</text>
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

    <!-- Body SVG -->
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
        <!-- region boxes (per-section rects) -->
        <template v-for="region in regions" :key="'region-' + region.id">
          <!-- individual section rects using sectionBounds -->
          <template v-for="(sec, si) in sectionBounds(region)" :key="'rsec-' + region.id + '-' + si">
            <!-- section background rect -->
            <rect
              :x="rLayout(region).left"
              :y="sec.topY"
              :width="rLayout(region).width"
              :height="sec.height"
              :fill="regionStyle(region).fill"
              :fill-opacity="(regionDepths.get(region.id) ?? 0) > 0 ? 0.35 : 0.25"
              :stroke="regionStyle(region).stroke"
              stroke-width="1.5"
              :stroke-dasharray="(regionDepths.get(region.id) ?? 0) > 0 ? '4 3' : '6 4'"
              rx="4"
              style="cursor:pointer"
              @mousedown.stop="sec.isMain ? onRegionClick(region, $event) : $event.stopPropagation()"
            />
            <!-- keyword badge (top-left of each section) -->
            <g style="cursor:pointer"
               @mousedown.stop="sec.isMain ? onRegionTypeClick(region, $event) : onDividerBadgeMousedown(region, sec.div, $event)">
              <rect
                :x="rLayout(region).left + 4"
                :y="sec.topY + 4"
                :width="sec.keyword.length * 7 + 10" height="16" rx="3"
                :fill="regionStyle(region).stroke"
                :fill-opacity="!sec.isMain && dividerCtxMenu?.divId === sec.div?.id ? 1 : 0.85"
              />
              <text
                :x="rLayout(region).left + 4 + (sec.keyword.length * 7 + 10) / 2"
                :y="sec.topY + 15"
                fill="white" font-size="10" text-anchor="middle"
                font-weight="bold" pointer-events="none"
              >{{ sec.keyword }}</text>
            </g>
            <!-- divider drag handle + editable label (sub-sections only) -->
            <template v-if="!sec.isMain && sec.div">
              <g style="cursor:ns-resize" @mousedown.stop="onDividerMousedown(region, sec.div, $event)">
                <line
                  :x1="rLayout(region).left + 4" :y1="sec.topY"
                  :x2="rLayout(region).right - 4" :y2="sec.topY"
                  stroke="transparent" stroke-width="16"
                />
                <line
                  :x1="rLayout(region).left + 4" :y1="sec.topY"
                  :x2="rLayout(region).right - 4" :y2="sec.topY"
                  :stroke="draggingDivId === sec.div.id ? '#f59e0b' : regionStyle(region).stroke"
                  :stroke-width="draggingDivId === sec.div.id ? 2 : 1"
                  stroke-dasharray="4 3"
                />
              </g>
              <text v-if="editingDividerId !== sec.div.id"
                :x="rLayout(region).left + 4 + dividerKeyword(region.type).length * 7 + 16"
                :y="sec.topY + 15"
                :fill="regionStyle(region).stroke"
                font-size="10" style="cursor:text"
                @dblclick.stop="startDividerLabelEdit(region, sec.div, $event)"
              >{{ sec.div.label || '...' }}</text>
              <foreignObject v-if="editingDividerId === sec.div.id"
                :x="rLayout(region).left + 4 + dividerKeyword(region.type).length * 7 + 16"
                :y="sec.topY + 5"
                width="130" height="16">
                <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
                  <input ref="editDividerLabelRef" v-model="editDividerLabel"
                         @keydown.enter.stop="commitDividerLabel"
                         @keydown.escape.stop="editingDividerId = null"
                         @blur="commitDividerLabel"
                         style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #818cf8;font-size:10px;padding:1px 3px;box-sizing:border-box;outline:none;" />
                </div>
              </foreignObject>
            </template>
          </template>
          <!-- right-side label: connector line + display/edit (anchored to top) -->
          <line
            :x1="seqBodyWidth - 10"
            :y1="regionY(region) + 12"
            :x2="seqBodyWidth + 12"
            :y2="regionY(region) + 12"
            :stroke="regionStyle(region).stroke"
            stroke-width="1" stroke-dasharray="3 2" opacity="0.7"
          />
          <text v-if="editingRegionId !== region.id"
            :x="seqBodyWidth + 18"
            :y="regionY(region) + 16"
            :fill="regionStyle(region).stroke"
            font-size="12" text-anchor="start"
            style="cursor:text"
            @dblclick.stop="startRegionLabelEdit(region)"
          >{{ region.label || 'what is this?' }}</text>
          <foreignObject v-if="editingRegionId === region.id"
            :x="seqBodyWidth + 14"
            :y="regionY(region) + 2"
            :width="REGION_LABEL_MARGIN - 24" height="28">
            <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
              <input ref="editRegionLabelRef" v-model="editRegionLabel"
                     @keydown.enter.stop="commitRegionLabel"
                     @keydown.escape.stop="editingRegionId = null"
                     @blur="commitRegionLabel"
                     style="width:100%;height:100%;background:#1e293b;color:#f3f4f6;border:1px solid #818cf8;font-size:11px;text-align:left;padding:2px 6px;box-sizing:border-box;outline:none;border-radius:3px;" />
            </div>
          </foreignObject>
          <!-- bottom border — full-width drag handle -->
          <g style="cursor:ns-resize" @mousedown.stop="onResizeHandleDown(region, $event)">
            <line
              :x1="rLayout(region).left" :y1="regionY(region) + regionHeight(region)"
              :x2="rLayout(region).right" :y2="regionY(region) + regionHeight(region)"
              stroke="transparent" stroke-width="16"
            />
            <rect
              :x="seqBodyWidth / 2 - 24"
              :y="regionY(region) + regionHeight(region) - 4"
              width="48" height="4" rx="2"
              :fill="regionStyle(region).stroke"
              :fill-opacity="resizingRegionId === region.id ? 1 : 0.5"
            />
          </g>
          <!-- bottom delete badge (rendered above resize handle so click takes priority) -->
          <g style="cursor:pointer" @mousedown.stop="onRegionDeleteBadgeMousedown(region, $event)">
            <rect
              :x="rLayout(region).left + 4"
              :y="regionY(region) + regionHeight(region) - 10"
              width="36" height="14" rx="3"
              :fill="regionStyle(region).stroke"
              :fill-opacity="regionCtxMenu?.regionId === region.id ? 1 : 0.65"
            />
            <text
              :x="32"
              :y="regionY(region) + regionHeight(region) - 1"
              fill="white" font-size="9" text-anchor="middle"
              font-weight="bold" pointer-events="none"
            >delete</text>
          </g>
        </template>
        <!-- region drag preview -->
        <rect v-if="regionDragPreview"
          :x="10"
          :y="Math.max(0, SEQ_BODY_PADDING + regionDragPreview.startSlot * seqFlowSpacing - seqFlowSpacing / 2)"
          :width="seqBodyWidth - 20"
          :height="(SEQ_BODY_PADDING + (regionDragPreview.endSlot + 1) * seqFlowSpacing - seqFlowSpacing / 2) - Math.max(0, SEQ_BODY_PADDING + regionDragPreview.startSlot * seqFlowSpacing - seqFlowSpacing / 2)"
          fill="#4f46e5" fill-opacity="0.12"
          stroke="#818cf8" stroke-width="1.5"
          stroke-dasharray="4 3" rx="4"
          pointer-events="none"
        />
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
          <text :x="edgeMidpoint(edge).x" :y="edgeMidpoint(edge).y"
                fill="#d1d5db" font-size="11" text-anchor="middle">{{ seqEdgeLabel(edge) }}</text>
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
    </div><!-- /inner width div -->
    </div><!-- /outer scroll container -->

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
      <marker id="arrowHeadSel" markerWidth="10" markerHeight="7"
              refX="9" refY="3.5" orient="auto">
        <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
      </marker>
      <marker id="arrowCross" markerWidth="10" markerHeight="10"
              refX="5" refY="5" orient="auto">
        <line x1="0" y1="0" x2="10" y2="10" stroke="#f87171" stroke-width="2"/>
        <line x1="10" y1="0" x2="0" y2="10" stroke="#f87171" stroke-width="2"/>
      </marker>

      <!-- ── Class diagram relation markers ── -->
      <!-- Hollow triangle START — inherit (◁ at fromNode/parent, tip touches boundary) -->
      <marker id="cls-inh" markerWidth="15" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 14,0 L 14,12 Z" fill="#030712" stroke="#818cf8" stroke-width="1.5" stroke-linejoin="round"/>
      </marker>
      <marker id="cls-inh-sel" markerWidth="15" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 14,0 L 14,12 Z" fill="#030712" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>
      </marker>
      <!-- Hollow triangle END — realize (▷ at toNode/interface, tip touches boundary) -->
      <marker id="cls-rlz" markerWidth="15" markerHeight="12" refX="14" refY="6" orient="auto">
        <path d="M 14,6 L 0,0 L 0,12 Z" fill="#030712" stroke="#818cf8" stroke-width="1.5" stroke-linejoin="round"/>
      </marker>
      <marker id="cls-rlz-sel" markerWidth="15" markerHeight="12" refX="14" refY="6" orient="auto">
        <path d="M 14,6 L 0,0 L 0,12 Z" fill="#030712" stroke="#f59e0b" stroke-width="1.5" stroke-linejoin="round"/>
      </marker>
      <!-- Filled diamond START — compose (◆ at fromNode/whole) -->
      <marker id="cls-cmp" markerWidth="18" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 8,1 L 16,6 L 8,11 Z" fill="#818cf8" stroke="#818cf8" stroke-width="1"/>
      </marker>
      <marker id="cls-cmp-sel" markerWidth="18" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 8,1 L 16,6 L 8,11 Z" fill="#f59e0b" stroke="#f59e0b" stroke-width="1"/>
      </marker>
      <!-- Hollow diamond START — aggregate (◇ at fromNode/whole) -->
      <marker id="cls-agg" markerWidth="18" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 8,1 L 16,6 L 8,11 Z" fill="#030712" stroke="#818cf8" stroke-width="1.5"/>
      </marker>
      <marker id="cls-agg-sel" markerWidth="18" markerHeight="12" refX="0" refY="6" orient="auto">
        <path d="M 0,6 L 8,1 L 16,6 L 8,11 Z" fill="#030712" stroke="#f59e0b" stroke-width="1.5"/>
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

    <!-- ── subgraphs / namespaces (rendered behind edges and nodes) ── -->
    <g v-for="sg in subgraphs" :key="'sg-' + sg.id"
       @mousedown.stop="onSgMousedown($event, sg)"
       @dblclick.stop="startSgLabelEdit(sg)">
      <rect
        :x="sg.x" :y="sg.y" :width="sg.width" :height="sg.height"
        :fill="sgStyle.fill"
        :stroke="selectedSgId === sg.id ? '#f59e0b' : sgStyle.stroke"
        :stroke-width="selectedSgId === sg.id ? 2 : 1.5"
        stroke-dasharray="6 4"
        rx="6"
        :style="{ cursor: mode === 'delete' ? 'not-allowed' : mode === 'select' ? 'move' : 'default' }"
      />
      <!-- label badge -->
      <rect v-if="editingSgId !== sg.id"
        :x="sg.x + 6" :y="sg.y + 4"
        :width="(sg.label || sgStyle.defaultLabel).length * 7 + 14" height="18"
        rx="3" :fill="sgStyle.badgeFill" fill-opacity="0.85"
      />
      <text v-if="editingSgId !== sg.id"
        :x="sg.x + 13" :y="sg.y + 16"
        :fill="sgStyle.textFill" font-size="11" font-weight="bold" pointer-events="none"
      >{{ sg.label || sgStyle.defaultLabel }}</text>
      <!-- inline label editor -->
      <foreignObject v-if="editingSgId === sg.id"
        :x="sg.x + 6" :y="sg.y + 4" width="160" height="20">
        <div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%">
          <input ref="editSgLabelRef" v-model="editSgLabel"
                 @keydown.enter.stop="commitSgLabel"
                 @keydown.escape.stop="editingSgId = null"
                 @blur="commitSgLabel"
                 :style="sgStyle.editorStyle" />
        </div>
      </foreignObject>
    </g>

    <!-- drag-to-draw preview -->
    <rect v-if="sgDragPreview"
      :x="sgDragPreview.x" :y="sgDragPreview.y"
      :width="sgDragPreview.width" :height="sgDragPreview.height"
      :fill="sgStyle.previewFill"
      :stroke="sgStyle.stroke" stroke-width="1.5" stroke-dasharray="6 4"
      rx="6" pointer-events="none"
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
      <!-- process / participant → plain rect -->
      <template v-if="['process','participant'].includes(node.type)">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="NODE_H"
          :fill="nodeColor(node.type).fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
      </template>

      <!-- class → expandable rect with member rows -->
      <template v-if="node.type === 'class'">
        <rect
          :x="effectiveX(node) - NODE_W / 2"
          :y="effectiveY(node) - NODE_H / 2"
          :width="NODE_W" :height="classNodeHeight(node)"
          :fill="nodeColor('class').fill"
          :stroke="strokeColor(node)"
          stroke-width="2"
        />
        <!-- header/body divider -->
        <line
          v-if="node.members?.length"
          :x1="effectiveX(node) - NODE_W / 2" :y1="effectiveY(node) + NODE_H / 2"
          :x2="effectiveX(node) + NODE_W / 2" :y2="effectiveY(node) + NODE_H / 2"
          :stroke="nodeColor('class').stroke" stroke-width="1" opacity="0.5"
        />
        <!-- member rows -->
        <g
          v-for="(member, i) in (node.members || [])"
          :key="'member-' + i"
          @mousedown.stop="onMemberRowMousedown($event, node.id, i)"
          @dblclick.stop="startEditMember(node, i, member, $event)"
          style="cursor:default"
        >
          <rect
            :x="effectiveX(node) - NODE_W / 2"
            :y="effectiveY(node) + NODE_H / 2 + i * 20"
            :width="NODE_W" height="20"
            :fill="mode === 'delete' ? 'rgba(248,113,113,0.12)' : 'transparent'"
            style="cursor:pointer"
          />
          <!-- hide row text while editing this member -->
          <template v-if="editingMemberNodeId === node.id && editingMemberIndex === i" />
          <template v-else>
          <!-- visibility -->
          <text
            :x="effectiveX(node) - NODE_W / 2 + 6"
            :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
            fill="#818cf8" font-size="10" text-anchor="start" pointer-events="none"
          >{{ member.visibility }}</text>
          <!-- field: vis Type name  /  method: vis name() ReturnType -->
          <template v-if="member.name.includes('(')">
            <text
              :x="effectiveX(node) - NODE_W / 2 + 18"
              :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
              fill="#e2e8f0" font-size="10" text-anchor="start" pointer-events="none"
            >{{ member.name }}</text>
            <text
              :x="effectiveX(node) - NODE_W / 2 + 18 + member.name.length * 6.5"
              :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
              fill="#a5b4fc" font-size="10" text-anchor="start" pointer-events="none"
            > {{ member.type }}</text>
          </template>
          <template v-else>
            <text
              :x="effectiveX(node) - NODE_W / 2 + 18"
              :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
              fill="#a5b4fc" font-size="10" text-anchor="start" pointer-events="none"
            >{{ member.type }}</text>
            <text
              :x="effectiveX(node) - NODE_W / 2 + 18 + member.type.length * 6.5"
              :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
              fill="#e2e8f0" font-size="10" text-anchor="start" pointer-events="none"
            > {{ member.name }}</text>
          </template>
          <text
            v-if="mode === 'delete'"
            :x="effectiveX(node) + NODE_W / 2 - 8"
            :y="effectiveY(node) + NODE_H / 2 + 14 + i * 20"
            fill="#f87171" font-size="11" text-anchor="middle" pointer-events="none"
          >×</text>
          </template><!-- /editing-hide -->
        </g>
        <!-- "+ member" button (select mode, selected node, not currently adding) -->
        <g
          v-if="mode === 'select' && selectedId === node.id && addingMemberNodeId !== node.id"
          @mousedown.stop="startAddMember(node, $event)"
          style="cursor:pointer"
        >
          <rect
            :x="effectiveX(node) - 24"
            :y="effectiveY(node) - NODE_H / 2 + classNodeHeight(node) + 3"
            width="48" height="14" rx="2"
            fill="#3730a3" opacity="0.85"
          />
          <text
            :x="effectiveX(node)"
            :y="effectiveY(node) - NODE_H / 2 + classNodeHeight(node) + 13"
            fill="#c7d2fe" font-size="9" text-anchor="middle" pointer-events="none"
          >+ member</text>
        </g>
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

    <!-- ── inline member add form (class diagram) ── -->
    <foreignObject
      v-if="addingMemberNodeId !== null"
      :x="(() => { const n = nodes.find(n => n.id === addingMemberNodeId); return n ? effectiveX(n) - NODE_W / 2 : 0 })()"
      :y="(() => { const n = nodes.find(n => n.id === addingMemberNodeId); return n ? effectiveY(n) - NODE_H / 2 + classNodeHeight(n) + 20 : 0 })()"
      width="266" height="28"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;gap:3px;height:100%">
        <!-- visibility -->
        <select
          v-model="newMemberVis"
          style="width:36px;background:#0f172a;color:#818cf8;border:1px solid #4f46e5;font-size:11px;padding:2px 2px;outline:none;box-sizing:border-box;"
        >
          <option value="+">+</option>
          <option value="-">-</option>
          <option value="#">#</option>
          <option value="~">~</option>
        </select>
        <!-- field / method toggle -->
        <button
          @mousedown.prevent.stop="toggleMemberKind"
          :style="`background:${newMemberIsMethod ? '#1e3a5f' : '#14532d'};color:${newMemberIsMethod ? '#93c5fd' : '#86efac'};border:1px solid ${newMemberIsMethod ? '#3b82f6' : '#22c55e'};font-size:10px;padding:2px 5px;cursor:pointer;border-radius:2px;white-space:nowrap;`"
        >{{ newMemberIsMethod ? 'M' : 'F' }}</button>
        <!-- type / return-type -->
        <input
          ref="newMemberTypeInputRef"
          v-model="newMemberType"
          :placeholder="newMemberIsMethod ? 'ret type' : 'type'"
          @keydown.enter.stop="commitAddMember"
          @keydown.tab.prevent="newMemberNameInputRef?.focus()"
          @keydown.escape.stop="addingMemberNodeId = null"
          style="width:60px;background:#0f172a;color:#a5b4fc;border:1px solid #4f46e5;font-size:11px;padding:2px 4px;outline:none;box-sizing:border-box;"
        />
        <!-- name -->
        <input
          ref="newMemberNameInputRef"
          v-model="newMemberName"
          :placeholder="newMemberIsMethod ? 'name(params)' : 'name'"
          @keydown.enter.stop="commitAddMember"
          @keydown.escape.stop="addingMemberNodeId = null"
          style="width:96px;background:#0f172a;color:#e2e8f0;border:1px solid #4f46e5;font-size:11px;padding:2px 4px;outline:none;box-sizing:border-box;"
        />
        <button
          @mousedown.prevent.stop="commitAddMember"
          style="background:#3730a3;color:#c7d2fe;border:none;font-size:11px;padding:2px 7px;cursor:pointer;border-radius:2px;"
        >✓</button>
      </div>
    </foreignObject>

    <!-- ── inline member edit form (class diagram) ── -->
    <foreignObject
      v-if="editingMemberNodeId !== null"
      :x="(() => { const n = nodes.find(n => n.id === editingMemberNodeId); return n ? effectiveX(n) - NODE_W / 2 : 0 })()"
      :y="(() => { const n = nodes.find(n => n.id === editingMemberNodeId); return n ? effectiveY(n) + NODE_H / 2 + editingMemberIndex * 20 : 0 })()"
      width="266" height="20"
    >
      <div xmlns="http://www.w3.org/1999/xhtml" style="display:flex;gap:3px;height:100%;align-items:center">
        <select
          v-model="editMemberVis"
          style="width:36px;height:18px;background:#0f172a;color:#818cf8;border:1px solid #f59e0b;font-size:11px;padding:0 2px;outline:none;box-sizing:border-box;"
        >
          <option value="+">+</option>
          <option value="-">-</option>
          <option value="#">#</option>
          <option value="~">~</option>
        </select>
        <button
          @mousedown.prevent.stop="toggleEditMemberKind"
          :style="`height:18px;background:${editMemberIsMethod ? '#1e3a5f' : '#14532d'};color:${editMemberIsMethod ? '#93c5fd' : '#86efac'};border:1px solid ${editMemberIsMethod ? '#3b82f6' : '#22c55e'};font-size:10px;padding:0 5px;cursor:pointer;border-radius:2px;`"
        >{{ editMemberIsMethod ? 'M' : 'F' }}</button>
        <input
          ref="editMemberTypeInputRef"
          v-model="editMemberType"
          :placeholder="editMemberIsMethod ? 'ret type' : 'type'"
          @keydown.enter.stop="commitEditMember"
          @keydown.tab.prevent="editMemberNameInputRef?.focus()"
          @keydown.escape.stop="editingMemberNodeId = null; editingMemberIndex = null"
          style="width:60px;height:18px;background:#0f172a;color:#a5b4fc;border:1px solid #f59e0b;font-size:11px;padding:0 4px;outline:none;box-sizing:border-box;"
        />
        <input
          ref="editMemberNameInputRef"
          v-model="editMemberName"
          :placeholder="editMemberIsMethod ? 'name(params)' : 'name'"
          @keydown.enter.stop="commitEditMember"
          @keydown.escape.stop="editingMemberNodeId = null; editingMemberIndex = null"
          style="width:96px;height:18px;background:#0f172a;color:#e2e8f0;border:1px solid #f59e0b;font-size:11px;padding:0 4px;outline:none;box-sizing:border-box;"
        />
        <button
          @mousedown.prevent.stop="commitEditMember"
          style="height:18px;background:#78350f;color:#fde68a;border:none;font-size:11px;padding:0 7px;cursor:pointer;border-radius:2px;"
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
    >{{ emptyHint }}</text>
  </svg>

  <!-- ── Class relation type context menu ── -->
  <div
    v-if="ctxEdgeId !== null && diagramType === 'class'"
    :style="{ position: 'absolute', left: ctxX + 'px', top: ctxY + 'px', zIndex: 50 }"
    class="bg-gray-800 border border-gray-600 rounded shadow-xl py-1 w-52 text-sm"
    @mousedown.stop
  >
    <div class="px-3 py-1 text-xs text-indigo-400 font-semibold tracking-wide">Relation Type</div>
    <div
      v-for="rel in CLASS_RELATIONS"
      :key="rel.type"
      :class="[
        'flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors',
        ctxEdge?.edgeType === rel.type ? 'bg-indigo-700 text-white' : 'text-gray-200 hover:bg-gray-700'
      ]"
      @mousedown.stop="selectClassRelation(rel.type)"
    >
      <code class="w-10 text-center font-mono text-xs opacity-75 shrink-0">{{ rel.symbol }}</code>
      <span>{{ rel.label }}</span>
    </div>
  </div>

  <!-- ── ER relation cardinality context menu ── -->
  <div
    v-if="ctxEdgeId !== null && diagramType === 'er'"
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

  <!-- divider delete context menu -->
  <div
    v-if="dividerCtxMenu"
    class="absolute z-50 overflow-hidden rounded shadow-xl border border-gray-600 text-xs"
    style="background:#1e293b; min-width:100px"
    :style="{ left: dividerCtxMenu.x + 'px', top: dividerCtxMenu.y + 'px' }"
    @mousedown.stop
  >
    <div
      class="flex items-center gap-2 px-3 py-2 cursor-pointer text-red-400 hover:bg-gray-700 transition-colors"
      @mousedown.stop="deleteDividerFromMenu"
    >
      <span>✕</span><span>Delete</span>
    </div>
  </div>

  <!-- region delete context menu -->
  <div
    v-if="regionCtxMenu"
    class="absolute z-50 overflow-hidden rounded shadow-xl border border-gray-600 text-xs"
    style="background:#1e293b; min-width:100px"
    :style="{ left: regionCtxMenu.x + 'px', top: regionCtxMenu.y + 'px' }"
    @mousedown.stop
  >
    <div
      class="flex items-center gap-2 px-3 py-2 cursor-pointer text-red-400 hover:bg-gray-700 transition-colors"
      @mousedown.stop="deleteRegionFromCtxMenu"
    >
      <span>✕</span><span>Delete Region</span>
    </div>
  </div>

  <!-- region type selection menu -->
  <div
    v-if="regionMenu"
    class="absolute z-50 overflow-hidden rounded shadow-xl border border-gray-600 text-xs"
    style="background:#1e293b; min-width:148px"
    :style="{ left: regionMenu.x + 'px', top: regionMenu.y + 'px' }"
    @mousedown.stop
  >
    <div class="px-3 py-1.5 text-gray-400 border-b border-gray-700 select-none">
      {{ regionMenu.targetRegionId !== null ? regionMenuI18n.changeType : regionMenuI18n.selectType }}
    </div>
    <div
      v-for="rt in REGION_TYPES"
      :key="rt.type"
      class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-gray-200 hover:bg-gray-700 transition-colors"
      :class="currentMenuRegion?.type === rt.type ? 'bg-gray-700' : ''"
      @mousedown.stop="onRegionMenuSelect(rt.type)"
    >
      <span class="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0" :style="{ background: rt.stroke }"></span>
      <span>{{ rt.label }}</span>
    </div>
    <!-- divider add option (alt / par / critical only) -->
    <template v-if="currentMenuRegion && ['alt','par','critical'].includes(currentMenuRegion.type)">
      <div class="border-t border-gray-700 my-0.5" />
      <div
        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-emerald-300 hover:bg-gray-700 transition-colors"
        @mousedown.stop="addDivider(currentMenuRegion)"
      >
        <span class="text-emerald-400">+</span>
        <span>add '{{ dividerKeyword(currentMenuRegion.type) }}'</span>
      </div>
    </template>
    <!-- delete option (only when editing an existing region) -->
    <template v-if="regionMenu.targetRegionId !== null">
      <div class="border-t border-gray-700 my-0.5" />
      <div
        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-red-400 hover:bg-gray-700 transition-colors"
        @mousedown.stop="onRegionMenuDelete"
      >
        <span>✕</span>
        <span>{{ regionMenuI18n.delete }}</span>
      </div>
    </template>
  </div>

  </div>
</template>
