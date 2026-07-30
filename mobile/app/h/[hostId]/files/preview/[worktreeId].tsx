import { useLocalSearchParams } from 'expo-router'
import { MobileFilePreviewScreen } from '../../../../../src/dev10x/files/MobileFilePreviewScreen'
import { normalizeMobileFilePreviewRouteParams } from '../../../../../src/dev10x/files/mobile-file-preview-route'

export default function MobileFilePreviewRoute() {
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    relativePath?: string | string[]
    source?: string | string[]
    absolutePath?: string | string[]
    grantId?: string | string[]
    line?: string | string[]
    column?: string | string[]
    name?: string | string[]
    worktreeName?: string | string[]
  }>()
  return <MobileFilePreviewScreen route={normalizeMobileFilePreviewRouteParams(params)} />
}
