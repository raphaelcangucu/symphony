import { describe, expect, it } from 'vitest'
import { dev10xComparisonAction } from './dev10x-comparison-navigation'

describe('dev10xComparisonAction', () => {
  it('opens an existing comparison from a marked parent task', () => {
    expect(
      dev10xComparisonAction({
        description: [
          'Compare the sites in the mobile app.',
          '',
          '```dev10x-comparison',
          '{"version":1,"brand":"Dev10x","matrix":"official-high-v1"}',
          '```'
        ].join('\n'),
        projectSlug: 'Dev10x Studio',
        identifier: 'DEV/1',
        subtaskCount: 6
      })
    ).toEqual({
      label: 'Open comparison',
      route: '/codex/issue/Dev10x%20Studio/DEV%2F1/comparison'
    })
  })

  it('returns no action for a regular task', () => {
    expect(
      dev10xComparisonAction({
        description: 'Ship the mobile app',
        projectSlug: 'mobile',
        identifier: 'DEV-2',
        subtaskCount: 0
      })
    ).toBeNull()
  })

  it('uses the loaded task detail when the list omits the description', () => {
    expect(
      dev10xComparisonAction({
        description: undefined,
        detailDescription: [
          'Compare the sites in the mobile app.',
          '',
          '```dev10x-comparison',
          '{"version":1,"brand":"Dev10x","matrix":"official-high-v1"}',
          '```'
        ].join('\n'),
        projectSlug: 'dev10x-mobile',
        identifier: 'DEV-1',
        subtaskCount: 0,
        detailSubtaskCount: 6
      })
    ).toEqual({
      label: 'Open comparison',
      route: '/codex/issue/dev10x-mobile/DEV-1/comparison'
    })
  })
})
