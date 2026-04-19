// ── Auto-layout helpers ───────────────────────────────────────────────────────
// direction: 'TD' → rows go downward (left-to-right within row)
//            'LR' → columns go rightward (top-to-bottom within column)
function autoLayoutGrid(nodes, direction = 'TD', colSpacingX = 200, rowSpacingY = 150, startX = 150, startY = 120) {
  if (!nodes.length) return
  if (direction === 'LR') {
    // LR: nodes spread left → right (wide layout), fill row by row
    const cols = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    nodes.forEach((node, i) => {
      node.x = startX + (i % cols) * colSpacingX
      node.y = startY + Math.floor(i / cols) * rowSpacingY
    })
  } else {
    // TD: nodes spread top → down (tall layout), fill column by column
    const rows = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
    nodes.forEach((node, i) => {
      node.x = startX + Math.floor(i / rows) * colSpacingX
      node.y = startY + (i % rows) * rowSpacingY
    })
  }
}

// ── Flowchart endpoint patterns (order matters: most specific first) ──────────
const FC_EP_PATTERNS = [
  { re: /^([A-Za-z0-9_]+)\[\/(.+?)\/\]$/,    type: 'io' },
  { re: /^([A-Za-z0-9_]+)\[\[(.+?)\]\]$/,    type: 'subprocess' },
  { re: /^([A-Za-z0-9_]+)\(\[(.+?)\]\)$/,    type: 'terminal' },
  { re: /^([A-Za-z0-9_]+)\[\((.+?)\)\]$/,    type: 'database' },
  { re: /^([A-Za-z0-9_]+)\(\((.+?)\)\)$/,    type: 'reference' },
  { re: /^([A-Za-z0-9_]+)\{(.+?)\}$/,        type: 'decision' },
  { re: /^([A-Za-z0-9_]+)@\{[^}]*label:\s*"([^"]+)"[^}]*\}$/, type: 'multiprocess' },
  { re: /^([A-Za-z0-9_]+)\[(.+?)\]$/,        type: 'process' },
  { re: /^([A-Za-z0-9_]+)$/,                 type: 'process', useId: true },
]

function parseFlowchartEndpoint(ep) {
  ep = ep.trim()
  for (const { re, type, useId } of FC_EP_PATTERNS) {
    const m = ep.match(re)
    if (m) return { mermaidId: m[1], type, label: useId ? m[1] : m[2] }
  }
  return null
}

function tryParseFlowchartEdge(trimmed) {
  let m

  // Arrow with label: A -->|label| B
  m = trimmed.match(/^(.+?)\s+-->\|([^|]*)\|\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[3])
    if (from && to) return { from, to, edgeType: 'arrow', label: m[2] }
  }

  // Open with label: A ---|label| B
  m = trimmed.match(/^(.+?)\s+---\|([^|]*)\|\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[3])
    if (from && to) return { from, to, edgeType: 'open', label: m[2] }
  }

  // Dotted with label: A -. text .-> B
  m = trimmed.match(/^(.+?)\s+-\.\s+(.+?)\s+\.->\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[3])
    if (from && to) return { from, to, edgeType: 'dotted', label: m[2] }
  }

  // Dotted no label: A -.-> B
  m = trimmed.match(/^(.+?)\s+-\.->\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[2])
    if (from && to) return { from, to, edgeType: 'dotted', label: '' }
  }

  // Arrow no label: A --> B
  m = trimmed.match(/^(.+?)\s+-->\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[2])
    if (from && to) return { from, to, edgeType: 'arrow', label: '' }
  }

  // Open no label: A --- B  (not --->)
  m = trimmed.match(/^(.+?)\s+---(?!>)\s+(.+)$/)
  if (m) {
    const from = parseFlowchartEndpoint(m[1])
    const to   = parseFlowchartEndpoint(m[2])
    if (from && to) return { from, to, edgeType: 'open', label: '' }
  }

  return null
}

// ── FLOWCHART parser ──────────────────────────────────────────────────────────
export function parseFlowchart(code) {
  const rawLines = code.split('\n')
  const resultLines = []
  const nodes = []
  const edges = []
  const nodeMap = new Map()   // mermaid string id → numeric id
  let nodeCounter = 1
  let edgeCounter = 1
  let direction = 'TD'

  function getOrCreate(mermaidId, type, label) {
    if (nodeMap.has(mermaidId)) return nodeMap.get(mermaidId)
    const numId = nodeCounter++
    nodes.push({ id: numId, type, label: label ?? mermaidId, x: 0, y: 0 })
    nodeMap.set(mermaidId, numId)
    return numId
  }

  // First line: extract direction
  const firstLine = rawLines[0] || ''
  const dirMatch = firstLine.trim().match(/^(?:flowchart|graph)\s+([A-Za-z]+)/i)
  if (dirMatch) {
    const d = dirMatch[1].toUpperCase()
    direction = d === 'TB' ? 'TD' : (d === 'LR' || d === 'TD') ? d : 'TD'
  }
  resultLines.push(firstLine)

  let inSubgraph = 0

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('%%')) { resultLines.push(line); continue }

    // Subgraph blocks
    if (/^subgraph\b/i.test(trimmed)) { inSubgraph++; resultLines.push(`%% ${line}`); continue }
    if (inSubgraph > 0) {
      if (/^end\b/i.test(trimmed)) inSubgraph--
      resultLines.push(`%% ${line}`); continue
    }

    // Unsupported directives
    if (/^(style|classDef|class\s|click|linkStyle)\b/i.test(trimmed)) {
      resultLines.push(`%% ${line}`); continue
    }

    // Try edge
    const edgeResult = tryParseFlowchartEdge(trimmed)
    if (edgeResult) {
      const { from, to, edgeType, label } = edgeResult
      const fromId = getOrCreate(from.mermaidId, from.type, from.label)
      const toId   = getOrCreate(to.mermaidId,   to.type,   to.label)
      edges.push({ id: edgeCounter++, from: fromId, to: toId, label, edgeType })
      resultLines.push(line); continue
    }

    // Try standalone node definition
    let parsed = false
    for (const { re, type, useId } of FC_EP_PATTERNS) {
      const m = trimmed.match(re)
      if (m) {
        getOrCreate(m[1], type, useId ? m[1] : m[2])
        resultLines.push(line)
        parsed = true; break
      }
    }
    if (!parsed) resultLines.push(`%% ${line}`)
  }

  autoLayoutGrid(nodes, direction, 200, 150)

  return {
    nodes, edges,
    activations: [], regions: [],
    direction,
    seqAutoNumber: false,
    modifiedCode: resultLines.join('\n'),
  }
}

// ── SEQUENCE parser ───────────────────────────────────────────────────────────
export function parseSequence(code) {
  const rawLines = code.split('\n')
  const resultLines = []
  const nodes = []
  const edges = []
  const activations = []
  const regions = []
  const nodeMap = new Map()
  let nodeCounter = 1
  let edgeCounter = 1
  let activationCounter = 1
  let regionCounter = 1
  let seqAutoNumber = false
  let slotCounter = 0
  const regionStack   = []   // only supported regions (loop/alt/opt/par/critical)
  const blockTypeStack = []  // 'supported' | 'unsupported' — tracks every block for end-matching

  const SEQ_OFFSET_X = 100
  const SEQ_PARTICIPANT_SPACING = 160

  function getOrCreateParticipant(id, type = 'participant', label = null) {
    if (nodeMap.has(id)) return nodeMap.get(id)
    const numId = nodeCounter++
    nodes.push({ id: numId, type, label: label ?? id, x: 0, y: 40 })
    nodeMap.set(id, numId)
    return numId
  }

  resultLines.push(rawLines[0])  // 'sequenceDiagram'

  for (let i = 1; i < rawLines.length; i++) {
    const line = rawLines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('%%')) { resultLines.push(line); continue }

    // autonumber
    if (/^autonumber$/i.test(trimmed)) {
      seqAutoNumber = true; resultLines.push(line); continue
    }

    let m

    // participant / actor declaration
    m = trimmed.match(/^(participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/i)
    if (m) {
      const type  = m[1].toLowerCase() === 'actor' ? 'actor' : 'participant'
      const id    = m[2]
      const label = m[3]?.trim() ?? m[2]
      getOrCreateParticipant(id, type, label)
      resultLines.push(line); continue
    }

    // activate / deactivate
    m = trimmed.match(/^(activate|deactivate)\s+(\S+)$/i)
    if (m) {
      const keyword = m[1].toLowerCase()
      const nodeId  = getOrCreateParticipant(m[2])
      if (keyword === 'activate') {
        activations.push({ id: activationCounter++, nodeId, startSlot: slotCounter, endSlot: slotCounter + 1 })
      } else {
        const act = [...activations].reverse().find(a => a.nodeId === nodeId)
        if (act) act.endSlot = slotCounter
      }
      resultLines.push(line); continue
    }

    // Messages (ordered: longer arrows first to avoid partial matches)
    m = trimmed.match(/^(\S+?)\s*(-->>|->>|-->|->|--x|-x|--\)|-\))\s*(\S+?)\s*:\s*(.*)$/)
    if (m) {
      const fromNum = getOrCreateParticipant(m[1])
      const toNum   = getOrCreateParticipant(m[3])
      const arrow   = m[2]
      const label   = m[4]
      let edgeType
      if (arrow === '-->>' || arrow === '-->' || arrow === '--)')  edgeType = 'dotted'
      else if (arrow === '-x' || arrow === '--x')                  edgeType = 'cross'
      else                                                          edgeType = 'solid'
      edges.push({ id: edgeCounter++, from: fromNum, to: toNum, label, edgeType, slot: slotCounter++ })
      resultLines.push(line); continue
    }

    // Region starts: rect rgb(...) — supported, ignore color (editor uses fixed colors per depth)
    if (/^rect\b/i.test(trimmed)) {
      const region = { id: regionCounter++, type: 'rect', label: '', startSlot: slotCounter, endSlot: slotCounter, dividers: [] }
      regions.push(region)
      regionStack.push(region)
      blockTypeStack.push('supported')
      resultLines.push(line); continue
    }

    // Region starts: loop/alt/opt/par/critical/break — supported
    m = trimmed.match(/^(loop|alt|opt|par|critical|break)\s*(.*)$/i)
    if (m) {
      const type   = m[1].toLowerCase()
      const label  = m[2].trim()
      const region = { id: regionCounter++, type, label, startSlot: slotCounter, endSlot: slotCounter, dividers: [] }
      regions.push(region)
      regionStack.push(region)
      blockTypeStack.push('supported')
      resultLines.push(line); continue
    }

    // Region dividers (only meaningful inside supported regions)
    m = trimmed.match(/^(else|and|option)\s*(.*)$/i)
    if (m) {
      const current = regionStack[regionStack.length - 1]
      if (current) current.dividers.push({ slot: slotCounter, label: m[2].trim() })
      resultLines.push(line); continue
    }

    // Unsupported block openers: box — comment out opener AND track depth
    // so their matching `end` is also commented out.
    if (/^box\b/i.test(trimmed)) {
      blockTypeStack.push('unsupported')
      resultLines.push(`%% ${line}`); continue
    }

    // end — decide based on which block type it closes
    if (/^end$/i.test(trimmed)) {
      const blockType = blockTypeStack.pop()
      if (blockType === 'unsupported') {
        // Close an unsupported block → comment out this end too
        resultLines.push(`%% ${line}`)
      } else {
        // Close a supported region
        const region = regionStack.pop()
        if (region) region.endSlot = slotCounter
        resultLines.push(line)
      }
      continue
    }

    // Unsupported single-line elements: note → comment out
    if (/^note\b/i.test(trimmed)) {
      resultLines.push(`%% ${line}`); continue
    }

    // Unknown
    resultLines.push(`%% ${line}`)
  }

  // Assign x positions in participant discovery order
  nodes.forEach((node, i) => { node.x = SEQ_OFFSET_X + i * SEQ_PARTICIPANT_SPACING })

  return {
    nodes, edges, activations, regions,
    direction: 'TD',
    seqAutoNumber,
    seqFlowCount: Math.max(slotCounter + 3, 10),
    modifiedCode: resultLines.join('\n'),
  }
}

// ── ER parser ─────────────────────────────────────────────────────────────────
export function parseER(code) {
  const rawLines = code.split('\n')
  const resultLines = []
  const nodes = []
  const edges = []
  const nodeMap = new Map()   // lowercase name → numeric id
  let nodeCounter = 1
  let edgeCounter = 1

  function getOrCreateEntity(name) {
    const key = name.toLowerCase()
    if (nodeMap.has(key)) return nodeMap.get(key)
    const numId = nodeCounter++
    nodes.push({ id: numId, type: 'entity', label: name, x: 0, y: 0, attributes: [] })
    nodeMap.set(key, numId)
    return numId
  }

  resultLines.push(rawLines[0])  // 'erDiagram'

  let i = 1
  while (i < rawLines.length) {
    const line = rawLines[i]
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('%%')) { resultLines.push(line); i++; continue }

    // direction: keep as-is (display only)
    if (/^direction\s/i.test(trimmed)) { resultLines.push(line); i++; continue }

    let m

    // Entity with attribute block: ENTITY {
    m = trimmed.match(/^([A-Za-z0-9_]+)\s*\{$/)
    if (m) {
      const numId = getOrCreateEntity(m[1])
      const node  = nodes.find(n => n.id === numId)
      resultLines.push(line)
      i++
      while (i < rawLines.length) {
        const attrLine    = rawLines[i]
        const attrTrimmed = attrLine.trim()
        if (attrTrimmed === '}') { resultLines.push(attrLine); i++; break }
        const am = attrTrimmed.match(/^(\S+)\s+(\S+)/)
        if (am && node) {
          node.attributes.push({ dataType: am[1], name: am[2] })
          resultLines.push(attrLine)
        } else if (attrTrimmed && !attrTrimmed.startsWith('%%')) {
          resultLines.push(`%% ${attrLine}`)
        } else {
          resultLines.push(attrLine)
        }
        i++
      }
      continue
    }

    // Relation: A ||--o{ B : "label"
    m = trimmed.match(/^([A-Za-z0-9_]+)\s+([|o{}]+--[|o{}]+)\s+([A-Za-z0-9_]+)\s*:\s*"?([^"]*)"?$/)
    if (m) {
      const fromId = getOrCreateEntity(m[1])
      const toId   = getOrCreateEntity(m[3])
      edges.push({ id: edgeCounter++, from: fromId, to: toId, label: m[4].trim(), edgeType: m[2] })
      resultLines.push(line); i++; continue
    }

    // Standalone entity
    m = trimmed.match(/^([A-Za-z0-9_]+)$/)
    if (m) { getOrCreateEntity(m[1]); resultLines.push(line); i++; continue }

    // Unknown
    resultLines.push(`%% ${line}`)
    i++
  }

  autoLayoutGrid(nodes, 'TD', 250, 200, 150, 150)

  return {
    nodes, edges,
    activations: [], regions: [],
    direction: 'TD',
    seqAutoNumber: false,
    modifiedCode: resultLines.join('\n'),
  }
}

// ── Type detection & entry point ──────────────────────────────────────────────
export function detectDiagramType(code) {
  const first = (code.trim().split('\n')[0] || '').trim().toLowerCase()
  if (first.startsWith('flowchart') || /^graph\s/.test(first)) return 'flowchart'
  if (first.startsWith('sequencediagram'))                       return 'sequence'
  if (first.startsWith('erdiagram'))                             return 'er'
  return null
}

export function parseDiagram(code) {
  const type = detectDiagramType(code)
  if (!type) return null
  switch (type) {
    case 'flowchart': return { type, ...parseFlowchart(code) }
    case 'sequence':  return { type, ...parseSequence(code) }
    case 'er':        return { type, ...parseER(code) }
  }
}
