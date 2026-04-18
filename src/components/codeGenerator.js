// Inner fill colors for nested regions (depth > 0), matching DiagramCanvas REGION_INNER_COLORS
const INNER_REGION_RGB = {
  rect:     'rgb(15, 118, 110)',
  alt:      'rgb(76, 29, 149)',
  par:      'rgb(29, 78, 216)',
  critical: 'rgb(185, 28, 28)',
  break:    'rgb(194, 65, 12)',
  opt:      'rgb(21, 128, 61)',
  loop:     'rgb(14, 116, 144)',
}

function computeRegionDepths(regions) {
  const depths = new Map()
  for (const r of regions) {
    let depth = 0
    for (const other of regions) {
      if (other.id !== r.id && other.startSlot <= r.startSlot && r.endSlot <= other.endSlot) depth++
    }
    depths.set(r.id, depth)
  }
  return depths
}

// Maps node index to letters: 0→A, 1→B, ..., 25→Z, 26→AA, etc.
function indexToLetter(i) {
  let result = ''
  let n = i
  do {
    result = String.fromCharCode(65 + (n % 26)) + result
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return result
}

function generateFlowchart(nodes, edges, direction) {
  const dir = direction || 'TD'
  if (nodes.length === 0) return `flowchart ${dir}`
  const lines = [`flowchart ${dir}`]
  const idMap = new Map() // node.id → mermaid letter ID
  nodes.forEach((node, i) => {
    const id = indexToLetter(i)
    idMap.set(node.id, id)
    const label = node.label || id
    switch (node.type) {
      case 'decision':
        lines.push(`  ${id}{${label}}`)
        break
      case 'terminal':
        lines.push(`  ${id}([${label}])`)
        break
      case 'io':
        lines.push(`  ${id}[/${label}/]`)
        break
      case 'database':
        lines.push(`  ${id}[(${label})]`)
        break
      case 'subprocess':
        lines.push(`  ${id}[[${label}]]`)
        break
      case 'multiprocess':
        lines.push(`  ${id}@{ shape: procs, label: "${label}" }`)
        break
      case 'reference':
        lines.push(`  ${id}((${label}))`)
        break
      default: // process
        lines.push(`  ${id}[${label}]`)
    }
  })
  edges.forEach(edge => {
    const fromId = idMap.get(edge.from)
    const toId = idMap.get(edge.to)
    if (!fromId || !toId) return
    const lbl = edge.label
    switch (edge.edgeType) {
      case 'open':
        lines.push(lbl ? `  ${fromId} ---|${lbl}| ${toId}` : `  ${fromId} --- ${toId}`)
        break
      case 'dotted':
        lines.push(lbl ? `  ${fromId} -. ${lbl} .-> ${toId}` : `  ${fromId} -.-> ${toId}`)
        break
      default: // arrow
        lines.push(lbl ? `  ${fromId} -->|${lbl}| ${toId}` : `  ${fromId} --> ${toId}`)
    }
  })
  return lines.join('\n')
}

function generateSequence(nodes, edges, autonumber, activations = [], regions = []) {
  if (nodes.length === 0) return 'sequenceDiagram'
  const lines = ['sequenceDiagram']
  if (autonumber) lines.push('  autonumber')
  // Sort participants by x position for display order
  const sorted = [...nodes].sort((a, b) => a.x - b.x)
  // Use letter IDs (A, B, C...) to avoid keyword conflicts with labels like "Participant"/"Actor"
  const idMap = new Map() // node.id → letter ID
  sorted.forEach((node, i) => {
    const id = indexToLetter(i)
    idMap.set(node.id, id)
    const keyword = node.type === 'actor' ? 'actor' : 'participant'
    lines.push(`  ${keyword} ${id} as ${node.label}`)
  })
  // Precompute depths and region lookup for nested color handling
  const regionDepths = computeRegionDepths(regions)
  const regionById = new Map(regions.map(r => [r.id, r]))
  // Build unified event list: messages + activation boundaries ordered by slot
  const events = []
  edges.forEach(edge => {
    events.push({ type: 'message', slot: edge.slot ?? edge.id, edge })
  })
  activations.forEach(act => {
    events.push({ type: 'activate',   slot: act.startSlot + 0.5, nodeId: act.nodeId })
    events.push({ type: 'deactivate', slot: act.endSlot   + 0.5, nodeId: act.nodeId })
  })
  regions.forEach(region => {
    events.push({ type: 'region-start', slot: region.startSlot - 0.5, region })
    if (region.dividers?.length) {
      region.dividers.forEach(div => {
        events.push({ type: 'region-divider', slot: div.slot - 0.5, divider: div, region })
      })
    }
    events.push({ type: 'region-end',   slot: region.endSlot   + 0.5, regionId: region.id })
  })
  events.sort((a, b) => a.slot - b.slot)
  events.forEach(ev => {
    if (ev.type === 'activate' || ev.type === 'deactivate') {
      const id = idMap.get(ev.nodeId)
      if (id) lines.push(`  ${ev.type} ${id}`)
    } else if (ev.type === 'region-start') {
      const { region } = ev
      const depth = regionDepths.get(region.id) ?? 0
      if (region.type === 'rect') {
        const rgb = depth > 0 ? INNER_REGION_RGB.rect : 'rgb(0, 179, 179)'
        lines.push(`  rect ${rgb}`)
      } else {
        if (depth > 0) {
          const rgb = INNER_REGION_RGB[region.type] || 'rgb(100, 100, 100)'
          lines.push(`  rect ${rgb}`)
        }
        const lbl = region.label ? ` ${region.label}` : ''
        lines.push(`  ${region.type}${lbl}`)
      }
    } else if (ev.type === 'region-divider') {
      const { divider, region } = ev
      const kw = region.type === 'alt' ? 'else' : region.type === 'par' ? 'and' : 'option'
      const lbl = divider.label ? ` ${divider.label}` : ''
      lines.push(`  ${kw}${lbl}`)
    } else if (ev.type === 'region-end') {
      const region = regionById.get(ev.regionId)
      const depth = region ? (regionDepths.get(ev.regionId) ?? 0) : 0
      lines.push(`  end`)
      // Close the wrapping rect block for nested non-rect regions
      if (depth > 0 && region && region.type !== 'rect') {
        lines.push(`  end`)
      }
    } else {
      const { edge } = ev
      const fromId = idMap.get(edge.from)
      const toId   = idMap.get(edge.to)
      if (!fromId || !toId) return
      const label = edge.label || (edge.slot !== undefined ? `msg-${edge.slot + 1}` : 'message')
      let arrow
      switch (edge.edgeType) {
        case 'dotted': arrow = '-->>'; break
        case 'cross':  arrow = '-x';   break
        default:       arrow = '->>'; break
      }
      lines.push(`  ${fromId}${arrow}${toId}: ${label}`)
    }
  })
  return lines.join('\n')
}

function generateER(nodes, edges, direction) {
  const dir = direction || 'TD'
  if (nodes.length === 0) return 'erDiagram'
  const lines = ['erDiagram']
  if (dir !== 'TD') lines.push(`  direction ${dir}`)
  const connectedIds = new Set(edges.flatMap(e => [e.from, e.to]))
  nodes.forEach(node => {
    const name = node.label.toUpperCase()
    const attrs = node.attributes || []
    if (attrs.length > 0) {
      lines.push(`  ${name} {`)
      attrs.forEach(attr => lines.push(`    ${attr.dataType} ${attr.name}`))
      lines.push(`  }`)
    } else if (!connectedIds.has(node.id)) {
      lines.push(`  ${name}`)
    }
  })
  edges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from)
    const toNode = nodes.find(n => n.id === edge.to)
    if (!fromNode || !toNode) return
    const label = (edge.label || 'relates').replace(/"/g, "'")
    let rel
    if (edge.edgeType?.includes('--')) {
      rel = edge.edgeType  // new granular format: use directly
    } else {
      // legacy preset format
      switch (edge.edgeType) {
        case '1:1':        rel = '||--||'; break
        case 'N:N':        rel = '}o--o{'; break
        case 'strict-1:N': rel = '||--|{'; break
        default:           rel = '||--o{'; break  // 1:N
      }
    }
    lines.push(`  ${fromNode.label.toUpperCase()} ${rel} ${toNode.label.toUpperCase()} : "${label}"`)
  })
  return lines.join('\n')
}

function generateClass(nodes, edges, direction) {
  const dir = direction || 'TD'
  if (nodes.length === 0) return 'classDiagram'
  const lines = ['classDiagram']
  if (dir !== 'TD') lines.push(`  direction ${dir}`)
  nodes.forEach(node => {
    lines.push(`  class ${node.label}`)
  })
  edges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from)
    const toNode = nodes.find(n => n.id === edge.to)
    if (!fromNode || !toNode) return
    let rel
    switch (edge.edgeType) {
      case 'inherit':   rel = '<|--'; break
      case 'compose':   rel = '*--';  break
      case 'aggregate': rel = 'o--';  break
      default:          rel = '-->'; break
    }
    const label = edge.label ? ` : ${edge.label}` : ''
    lines.push(`  ${fromNode.label} ${rel} ${toNode.label}${label}`)
  })
  return lines.join('\n')
}

export function generateCode(type, nodes, edges, options) {
  const dir = options?.direction
  switch (type) {
    case 'sequence': return generateSequence(nodes, edges, options?.autonumber, options?.activations, options?.regions)
    case 'er':       return generateER(nodes, edges, dir)
    case 'class':    return generateClass(nodes, edges, dir)
    default:         return generateFlowchart(nodes, edges, dir)
  }
}
