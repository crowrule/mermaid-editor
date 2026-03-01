export const TEMPLATES = [
  {
    id: 'flowchart',
    label: 'Flowchart',
    code: `flowchart TD
    A[Start] --> B{Is it working?}
    B -- Yes --> C[Great!]
    B -- No --> D[Debug]
    D --> B`,
  },
  {
    id: 'sequence',
    label: 'Sequence Diagram',
    code: `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello Bob, how are you?
    Bob-->>Alice: Great! And you?
    Alice->>Bob: Good, thanks!`,
  },
  {
    id: 'er',
    label: 'ER Diagram',
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER {
        string name
        string email
    }
    ORDER {
        int id
        date created
    }`,
  },
  {
    id: 'class',
    label: 'Class Diagram',
    code: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() void
    }
    class Dog {
        +fetch() void
    }
    Animal <|-- Dog`,
  },
  {
    id: 'gantt',
    label: 'Gantt Chart',
    code: `gantt
    title Project Schedule
    dateFormat  YYYY-MM-DD
    section Phase 1
    Design      :a1, 2024-01-01, 14d
    section Phase 2
    Development :a2, after a1, 30d
    section Phase 3
    Testing     :a3, after a2, 14d`,
  },
]

export const DEFAULT_TEMPLATE = TEMPLATES[0]
