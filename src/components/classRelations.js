export const CLASS_RELATIONS = [
  { type: 'inherit',     label: 'Inheritance',   symbol: '<|--' },
  { type: 'realize',     label: 'Realization',   symbol: '..|>' },
  { type: 'compose',     label: 'Composition',   symbol: '*--'  },
  { type: 'aggregate',   label: 'Aggregation',   symbol: 'o--'  },
  { type: 'assoc',       label: 'Association',   symbol: '-->'  },
  { type: 'dependent',   label: 'Dependency',    symbol: '..>'  },
  { type: 'link-solid',  label: 'Link (Solid)',  symbol: '--'   },
  { type: 'link-dashed', label: 'Link (Dashed)', symbol: '..'   },
]

export const CLASS_RELATION_LABELS = Object.fromEntries(
  CLASS_RELATIONS.map(r => [r.type, r.label])
)
