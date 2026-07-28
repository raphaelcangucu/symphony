import { isComparisonTask } from '../../features/comparisons/comparison-task'

export type Dev10xComparisonAction = {
  label: 'Open comparison' | 'Run comparison'
  route: string
}

export function dev10xComparisonAction(input: {
  description: string | null | undefined
  detailDescription?: string | null
  projectSlug: string
  identifier: string
  subtaskCount: number
  detailSubtaskCount?: number
}): Dev10xComparisonAction | null {
  if (!isComparisonTask(input.detailDescription ?? input.description)) {
    return null
  }

  return {
    label:
      (input.detailSubtaskCount ?? input.subtaskCount) > 0
        ? 'Open comparison'
        : 'Run comparison',
    route: `/codex/issue/${encodeURIComponent(input.projectSlug)}/${encodeURIComponent(
      input.identifier
    )}/comparison`
  }
}
