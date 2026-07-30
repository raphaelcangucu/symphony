import { useCallback, useMemo } from 'react'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { MobileDiffReviewScreenView } from '../../../../src/dev10x/components/MobileDiffReviewScreenView'
import {
  firstReviewParam,
  normalizeReviewFilterParam
} from '../../../../src/dev10x/session/mobile-diff-review-screen-model'
import { normalizeReviewAreaParam } from '../../../../src/dev10x/session/mobile-diff-review-positioning'
import { useMobileDiffReviewController } from '../../../../src/dev10x/session/use-mobile-diff-review-controller'
import { useForceReconnect, useHostClient } from '../../../../src/dev10x/transport/client-context'

export default function MobileDiffReviewScreen() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
    scope?: string | string[]
    file?: string | string[]
    area?: string | string[]
  }>()
  const hostId = firstReviewParam(params.hostId)
  const worktreeId = firstReviewParam(params.worktreeId)
  const name = firstReviewParam(params.name)
  const initialFilter = normalizeReviewFilterParam(firstReviewParam(params.scope))
  const initialFile = firstReviewParam(params.file)
  const initialArea = normalizeReviewAreaParam(firstReviewParam(params.area))
  const initialTarget = useMemo(
    () => (initialFile && initialArea ? { filePath: initialFile, area: initialArea } : null),
    [initialArea, initialFile]
  )
  const router = useRouter()
  const { client, state: connState } = useHostClient(hostId)
  const forceReconnect = useForceReconnect()

  const openSession = useCallback(() => {
    const query = name ? `?${new URLSearchParams({ name }).toString()}` : ''
    router.replace(
      `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(worktreeId)}${query}`
    )
  }, [hostId, name, router, worktreeId])

  const controller = useMobileDiffReviewController({
    client,
    connState,
    hostId,
    worktreeId,
    name,
    initialFilter,
    initialTarget,
    onOpenSession: openSession,
    onReconnect: forceReconnect
  })

  return <MobileDiffReviewScreenView controller={controller} onBack={() => router.back()} />
}
