export const GRAPH_SOURCE = 'plugin:dsh-yu-memory-graph'

export function sourceKindOf(message) {
  return String(message?.source?.kind || message?.message?.source?.kind || '')
}

export function isGraphInjected(message) {
  return sourceKindOf(message) === GRAPH_SOURCE
}
