<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { generateCode } from './components/codeGenerator.js'
import { detectDiagramType, parseDiagram } from './components/diagramParser.js'
import VisualEditor from './components/VisualEditor.vue'
import DiagramPreview from './components/DiagramPreview.vue'
import DiagramEditor from './components/DiagramEditor.vue'
import ToolBar from './components/ToolBar.vue'

const diagramType = ref('flowchart')
const diagramDirection = ref('TD')
const seqAutoNumber = ref(false)
const nodes = ref([])
const edges = ref([])
const activations = ref([])
const regions    = ref([])
const subgraphs  = ref([])
const diagramCode = ref('')
const rightTab = ref('preview')
const previewRef = ref(null)
const seqFlowCountInit = ref(null)   // set on file load to sync VisualEditor

let loadingFile = false              // suppresses watchers during file load

// ── unsupported diagram type popup ────────────────────────────────────────────
const showUnsupportedPopup = ref(false)

// ── clear confirmation ────────────────────────────────────────────────────────
const showClearConfirm = ref(false)

function requestClear() {
  showClearConfirm.value = true
}

function confirmClear() {
  showClearConfirm.value = false
  nodes.value       = []
  edges.value       = []
  activations.value = []
  regions.value     = []
  subgraphs.value   = []
  nodeIdCounter       = 1
  edgeIdCounter       = 1
  activationIdCounter = 1
  regionIdCounter     = 1
  subgraphIdCounter   = 1
  diagramDirection.value = 'TD'
  seqAutoNumber.value    = false
}

function cancelClear() {
  showClearConfirm.value = false
}

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
  const type = pendingDiagramType.value
  pendingDiagramType.value = null
  diagramType.value = type
}

function cancelDiagramTypeChange() {
  pendingDiagramType.value = null
}

let nodeIdCounter = 1
let edgeIdCounter = 1
let activationIdCounter = 1
let regionIdCounter    = 1
let subgraphIdCounter  = 1

// ── resizable divider ──────────────────────────────────────────────────────────
const leftPct = ref(60)
const isResizing = ref(false)
const mainRef = ref(null)

// Both panels support horizontal scrolling, so only enforce a small fixed minimum.
const MIN_PANEL_PX = 200

function onDividerMousedown(e) {
  isResizing.value = true
  e.preventDefault()
}
function onGlobalMousemove(e) {
  if (!isResizing.value || !mainRef.value) return
  const rect = mainRef.value.getBoundingClientRect()
  const DIVIDER_W = 6
  const minPct = (MIN_PANEL_PX / rect.width) * 100
  const maxPct = ((rect.width - MIN_PANEL_PX - DIVIDER_W) / rect.width) * 100
  const pct = ((e.clientX - rect.left) / rect.width) * 100
  leftPct.value = Math.min(Math.max(pct, minPct), maxPct)
}
function onGlobalMouseup() {
  isResizing.value = false
}
onMounted(() => {
  window.addEventListener('mousemove', onGlobalMousemove)
  window.addEventListener('mouseup', onGlobalMouseup)
  document.addEventListener('mousedown', onLangMenuClickOutside)
})
onUnmounted(() => {
  window.removeEventListener('mousemove', onGlobalMousemove)
  window.removeEventListener('mouseup', onGlobalMouseup)
  document.removeEventListener('mousedown', onLangMenuClickOutside)
})

// Auto-generate mermaid code whenever visual state changes
watch([diagramType, diagramDirection, seqAutoNumber, nodes, edges, activations, regions, subgraphs], () => {
  if (loadingFile) return
  diagramCode.value = generateCode(diagramType.value, nodes.value, edges.value, {
    direction:   diagramDirection.value,
    autonumber:  seqAutoNumber.value,
    activations: activations.value,
    regions:     regions.value,
    subgraphs:   subgraphs.value,
  })
}, { deep: true })

// Clear canvas when diagram type changes
watch(diagramType, () => {
  if (loadingFile) return
  nodes.value       = []
  edges.value       = []
  activations.value = []
  regions.value     = []
  subgraphs.value   = []
  nodeIdCounter       = 1
  edgeIdCounter       = 1
  activationIdCounter = 1
  regionIdCounter     = 1
  subgraphIdCounter   = 1
  diagramDirection.value = 'TD'
  seqAutoNumber.value    = false
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
  const node = {
    id: nodeIdCounter++,
    type: type || 'process',
    label: uniqueLabel(type),
    x,
    y,
  }
  if (type === 'entity') node.attributes = []
  nodes.value.push(node)
}

function handleAddAttribute(nodeId, dataType, name) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (!node) return
  if (!node.attributes) node.attributes = []
  node.attributes.push({ dataType, name })
}

function handleDeleteAttribute(nodeId, index) {
  const node = nodes.value.find(n => n.id === nodeId)
  if (!node || !node.attributes) return
  node.attributes.splice(index, 1)
}

function handleMoveNode(id, x, y) {
  const node = nodes.value.find(n => n.id === id)
  if (node) { node.x = x; node.y = y }
}

function handleAddEdge(fromId, toId, edgeType, slot) {
  // Sequence allows multiple messages between same participants; others prevent duplicates
  if (diagramType.value !== 'sequence') {
    const exists = edges.value.some(e => e.from === fromId && e.to === toId)
    if (exists) return
  }
  // ER always defaults to 1:N; other types use the toolbar selection
  const type = diagramType.value === 'er' ? '||--o{' : (edgeType || 'arrow')
  const edge = {
    id: edgeIdCounter++,
    from: fromId,
    to: toId,
    label: '',
    edgeType: type,
  }
  if (slot !== undefined) edge.slot = slot
  edges.value.push(edge)
}

function handleUpdateEdgeType(id, edgeType) {
  const edge = edges.value.find(e => e.id === id)
  if (edge) edge.edgeType = edgeType
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

function handleUpdateEdgeLabel(id, label) {
  const edge = edges.value.find(e => e.id === id)
  if (edge) edge.label = label
}

function handleInsertSlot(slotIdx, position) {
  const insertAt = position === 'above' ? slotIdx : slotIdx + 1
  edges.value.forEach(edge => {
    if (edge.slot !== undefined && edge.slot >= insertAt) edge.slot += 1
  })
  activations.value.forEach(act => {
    if (act.startSlot >= insertAt) act.startSlot += 1
    if (act.endSlot   >= insertAt) act.endSlot   += 1
  })
  regions.value.forEach(region => {
    if (region.startSlot >= insertAt) region.startSlot += 1
    if (region.endSlot   >= insertAt) region.endSlot   += 1
    region.dividers?.forEach(div => {
      if (div.slot >= insertAt) div.slot += 1
    })
  })
}

function handleAddRegion(startSlot, endSlot, type, label) {
  regions.value.push({ id: regionIdCounter++, type, startSlot, endSlot, label: label ?? 'what is this?' })
}

function handleUpdateRegion(id, updates) {
  const region = regions.value.find(r => r.id === id)
  if (region) Object.assign(region, updates)
}

function handleDeleteRegion(id) {
  regions.value = regions.value.filter(r => r.id !== id)
}

function handleAddSubgraph(x, y, width, height) {
  subgraphs.value.push({ id: subgraphIdCounter++, label: `Group ${subgraphIdCounter - 1}`, x, y, width, height })
}
function handleUpdateSubgraph(id, updates) {
  const sg = subgraphs.value.find(s => s.id === id)
  if (sg) Object.assign(sg, updates)
}
function handleDeleteSubgraph(id) {
  subgraphs.value = subgraphs.value.filter(s => s.id !== id)
}

function handleAddActivation(nodeId, startSlot, endSlot) {
  activations.value.push({ id: activationIdCounter++, nodeId, startSlot, endSlot })
}

function handleDeleteActivation(id) {
  activations.value = activations.value.filter(a => a.id !== id)
}

function handleCodeChange(code) {
  diagramCode.value = code
}

// ── save / open ───────────────────────────────────────────────────────────────
async function saveCode() {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'diagram.mermaid',
        types: [{ description: 'Mermaid Diagram', accept: { 'text/plain': ['.mermaid'] } }],
      })
      const writable = await handle.createWritable()
      await writable.write(diagramCode.value)
      await writable.close()
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e)
    }
  } else {
    // Fallback: download via anchor
    const blob = new Blob([diagramCode.value], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url; a.download = 'diagram.mermaid'; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 100)
  }
}

async function openCode() {
  let text = null

  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Mermaid Diagram', accept: { 'text/plain': ['.mermaid', '.md', '.txt'] } }],
        multiple: false,
      })
      text = await (await handle.getFile()).text()
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e)
      return
    }
  } else {
    text = await new Promise(resolve => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.mermaid,.md,.txt'
      input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null)
      input.oncancel  = () => resolve(null)
      input.click()
    })
    if (!text) return
  }

  // Detect and validate diagram type
  const detectedType = detectDiagramType(text)
  if (!detectedType) {
    showUnsupportedPopup.value = true
    return
  }

  const parsed = parseDiagram(text)
  if (!parsed) { showUnsupportedPopup.value = true; return }

  // Load into state — suppress watchers during the batch update
  loadingFile = true

  diagramType.value       = parsed.type
  diagramDirection.value  = parsed.direction  || 'TD'
  seqAutoNumber.value     = parsed.seqAutoNumber || false
  nodes.value             = parsed.nodes
  edges.value             = parsed.edges
  activations.value       = parsed.activations || []
  regions.value           = parsed.regions     || []

  // Reset ID counters above highest parsed ID
  const maxId = (arr) => arr.length ? Math.max(...arr.map(x => x.id)) : 0
  nodeIdCounter       = maxId(parsed.nodes)       + 1
  edgeIdCounter       = maxId(parsed.edges)       + 1
  activationIdCounter = maxId(parsed.activations || []) + 1
  regionIdCounter     = maxId(parsed.regions     || []) + 1

  // Propagate seqFlowCount to VisualEditor
  if (parsed.seqFlowCount) seqFlowCountInit.value = parsed.seqFlowCount

  // Set code with commented-out unsupported lines
  diagramCode.value = parsed.modifiedCode

  // Wait for watchers to flush (they will be suppressed by loadingFile)
  await nextTick()
  loadingFile = false
}

// ── i18n ──────────────────────────────────────────────────────────────────────
const TRANSLATIONS = {
  ko: {
    unsupportedTitle:  '지원하지 않는 다이어그램',
    unsupportedBody:   'Flowchart, Sequence Diagram, ER Diagram\n파일만 불러올 수 있습니다.',
    unsupportedClose:  '닫기',
    clearTitle:        '캔버스 초기화',
    clearBody:         '현재 캔버스에 그려진 내용이 모두 삭제됩니다.\n계속 하시겠습니까?',
    clearCancel:       '취소',
    clearConfirm:      '초기화',
    typeChangeTitle:   '다이어그램 종류 변경',
    typeChangeBody:    '현재 캔버스에 그려진 내용이 모두 삭제됩니다.\n계속 하시겠습니까?',
    typeChangeCancel:  '취소',
    typeChangeConfirm: '확인',
  },
  en: {
    unsupportedTitle:  'Unsupported Diagram Type',
    unsupportedBody:   'Only Flowchart, Sequence, and ER Diagram\nfiles can be opened.',
    unsupportedClose:  'Close',
    clearTitle:        'Clear Canvas',
    clearBody:         'All content on the canvas will be deleted.\nDo you want to continue?',
    clearCancel:       'Cancel',
    clearConfirm:      'Clear',
    typeChangeTitle:   'Change Diagram Type',
    typeChangeBody:    'All content on the canvas will be deleted.\nDo you want to continue?',
    typeChangeCancel:  'Cancel',
    typeChangeConfirm: 'Confirm',
  },
  es: {
    unsupportedTitle:  'Tipo no compatible',
    unsupportedBody:   'Solo se pueden abrir archivos de tipo\nFlowchart, Sequence y ER Diagram.',
    unsupportedClose:  'Cerrar',
    clearTitle:        'Limpiar lienzo',
    clearBody:         'Todo el contenido del lienzo será eliminado.\n¿Deseas continuar?',
    clearCancel:       'Cancelar',
    clearConfirm:      'Limpiar',
    typeChangeTitle:   'Cambiar tipo de diagrama',
    typeChangeBody:    'Todo el contenido del lienzo será eliminado.\n¿Deseas continuar?',
    typeChangeCancel:  'Cancelar',
    typeChangeConfirm: 'Confirmar',
  },
}

const lang = ref('en')
const showLangMenu = ref(false)
const langMenuRef  = ref(null)

const t = computed(() => TRANSLATIONS[lang.value])

const LANG_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'ko', label: '한국어' },
]

function selectLang(value) {
  lang.value = value
  showLangMenu.value = false
}

function onLangMenuClickOutside(e) {
  if (langMenuRef.value && !langMenuRef.value.contains(e.target)) {
    showLangMenu.value = false
  }
}
</script>

<template>
  <div class="flex flex-col h-screen bg-gray-900 text-gray-100">
    <!-- ── header ── -->
    <header class="flex items-center gap-4 px-4 py-2 bg-gray-800 border-b border-gray-700 shrink-0">
      <h1 class="text-xl font-bold text-indigo-400 tracking-wide">Mermaid Editor <span class="text-gray-400 font-normal text-sm">(dev)</span></h1>

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

      <!-- ── language selector ── -->
      <div ref="langMenuRef" class="relative">
        <button
          @click="showLangMenu = !showLangMenu"
          class="flex items-center justify-center w-8 h-8 rounded text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          title="Language"
        >
          <!-- Globe SVG -->
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
               class="w-5 h-5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/>
          </svg>
        </button>

        <Transition name="fade">
          <div
            v-if="showLangMenu"
            class="absolute left-0 top-full mt-1 z-30 min-w-[120px] bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden"
          >
            <button
              v-for="opt in LANG_OPTIONS"
              :key="opt.value"
              @click="selectLang(opt.value)"
              :class="[
                'w-full text-left px-4 py-2 text-sm transition-colors',
                lang === opt.value  /* template auto-unwraps ref */
                  ? 'bg-indigo-700 text-white'
                  : 'text-gray-300 hover:bg-gray-700'
              ]"
            >{{ opt.label }}</button>
          </div>
        </Transition>
      </div>

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
        :seq-auto-number="seqAutoNumber"
        :lang="lang"
        :seq-flow-count-init="seqFlowCountInit"
        :nodes="nodes"
        :edges="edges"
        :activations="activations"
        :regions="regions"
        :subgraphs="subgraphs"
        @add-node="handleAddNode"
        @move-node="handleMoveNode"
        @add-edge="handleAddEdge"
        @delete-node="handleDeleteNode"
        @delete-edge="handleDeleteEdge"
        @update-label="handleUpdateLabel"
        @update-edge-label="handleUpdateEdgeLabel"
        @add-attribute="handleAddAttribute"
        @delete-attribute="handleDeleteAttribute"
        @update-edge-type="handleUpdateEdgeType"
        @update:diagram-direction="diagramDirection = $event"
        @update:seq-auto-number="seqAutoNumber = $event"
        @add-activation="handleAddActivation"
        @delete-activation="handleDeleteActivation"
        @insert-slot="handleInsertSlot"
        @add-region="handleAddRegion"
        @update-region="handleUpdateRegion"
        @delete-region="handleDeleteRegion"
        @add-subgraph="handleAddSubgraph"
        @update-subgraph="handleUpdateSubgraph"
        @delete-subgraph="handleDeleteSubgraph"
        @clear="requestClear"
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
        <div class="flex items-center bg-gray-800 border-b border-gray-700 shrink-0">
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

          <!-- tab-contextual action buttons -->
          <div class="ml-auto flex items-center gap-2 pr-3">
            <template v-if="rightTab === 'preview'">
              <ToolBar :preview-ref="previewRef" />
            </template>
            <template v-else>
              <button
                @click="openCode"
                class="px-3 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >Open</button>
              <button
                @click="saveCode"
                class="px-3 py-1 text-xs rounded bg-indigo-700 text-white hover:bg-indigo-600 transition-colors"
              >Save</button>
            </template>
          </div>
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

    <!-- ── unsupported diagram type modal ── -->
    <Transition name="fade">
      <div
        v-if="showUnsupportedPopup"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="showUnsupportedPopup = false"
      >
        <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 p-6 flex flex-col gap-4">
          <div class="flex items-center gap-2">
            <span class="text-yellow-400 text-lg">⚠</span>
            <h2 class="text-base font-semibold text-gray-100">{{ t.unsupportedTitle }}</h2>
          </div>
          <p class="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{{ t.unsupportedBody }}</p>
          <div class="flex justify-end">
            <button
              @click="showUnsupportedPopup = false"
              class="px-4 py-1.5 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >{{ t.unsupportedClose }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── clear confirmation modal ── -->
    <Transition name="fade">
      <div
        v-if="showClearConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="cancelClear"
      >
        <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 p-6 flex flex-col gap-4">
          <h2 class="text-base font-semibold text-gray-100">{{ t.clearTitle }}</h2>
          <p class="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{{ t.clearBody }}</p>
          <div class="flex justify-end gap-2">
            <button
              @click="cancelClear"
              class="px-4 py-1.5 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >{{ t.clearCancel }}</button>
            <button
              @click="confirmClear"
              class="px-4 py-1.5 text-sm rounded bg-red-700 text-white hover:bg-red-600 transition-colors"
            >{{ t.clearConfirm }}</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ── diagram type change confirmation modal ── -->
    <Transition name="fade">
      <div
        v-if="pendingDiagramType"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
        @click.self="cancelDiagramTypeChange"
      >
        <div class="bg-gray-800 border border-gray-600 rounded-lg shadow-xl w-80 p-6 flex flex-col gap-4">
          <h2 class="text-base font-semibold text-gray-100">{{ t.typeChangeTitle }}</h2>
          <p class="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{{ t.typeChangeBody }}</p>
          <div class="flex justify-end gap-2">
            <button
              @click="cancelDiagramTypeChange"
              class="px-4 py-1.5 text-sm rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
            >{{ t.typeChangeCancel }}</button>
            <button
              @click="confirmDiagramTypeChange"
              class="px-4 py-1.5 text-sm rounded bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
            >{{ t.typeChangeConfirm }}</button>
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
