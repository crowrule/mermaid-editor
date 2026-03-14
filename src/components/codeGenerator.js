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

function generateSequence(nodes, edges) {
  if (nodes.length === 0) return 'sequenceDiagram'
  const lines = ['sequenceDiagram']
  // Sort participants by x position for display order
  const sorted = [...nodes].sort((a, b) => a.x - b.x)
  sorted.forEach(node => {
    const keyword = node.type === 'actor' ? 'actor' : 'participant'
    lines.push(`  ${keyword} ${node.label}`)
  })
  // Sort messages by creation order (edge id)
  const sortedEdges = [...edges].sort((a, b) => a.id - b.id)
  sortedEdges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from)
    const toNode = nodes.find(n => n.id === edge.to)
    if (!fromNode || !toNode) return
    const label = edge.label || 'message'
    let arrow
    switch (edge.edgeType) {
      case 'dotted': arrow = '-->>'; break
      case 'cross':  arrow = '-x';   break
      default:       arrow = '->>'; break
    }
    lines.push(`  ${fromNode.label}${arrow}${toNode.label}: ${label}`)
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
    case 'sequence': return generateSequence(nodes, edges)
    case 'er':       return generateER(nodes, edges, dir)
    case 'class':    return generateClass(nodes, edges, dir)
    default:         return generateFlowchart(nodes, edges, dir)
  }
}
