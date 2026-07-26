import { useCallback, useRef, useState } from 'react'
import { View, Text, StyleSheet, Pressable, ActivityIndicator, BackHandler } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useConnection } from '../src/auth/ConnectionProvider'
import { redactPairingSecrets } from '../src/auth/pairing-offer'
import { pairHostOffer } from '../src/features/connect/pair-host'
import { resolvePairConfirmRouteState } from '../src/dev10x/transport/pair-confirm-state'
import type { ConnectionLogEntry } from '../src/dev10x/transport/types'
import { colors, spacing, radii, typography } from '../src/dev10x/theme/mobile-theme'
import { ConnectionLog } from '../src/dev10x/components/ConnectionLog'

type Status = 'awaiting-confirm' | 'connecting' | 'error'

// Why: cap how long the user stares at "Connecting…" during pairing.
// rpc-client retries forever by design (good for live sessions), but for
// the *initial* pair we want a hard ceiling so a half-broken Tailscale
// route surfaces an actionable error with the log visible, instead of
// spinning silently. ~25s allows for one full connect-timeout + a retry.
const PAIRING_OVERALL_TIMEOUT_MS = 25_000

export default function PairConfirmScreen() {
  const router = useRouter()
  const { saveHostProfile } = useConnection()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ code?: string }>()
  const [status, setStatus] = useState<Status>('awaiting-confirm')
  const [errorMessage, setErrorMessage] = useState('')
  const [logs, setLogs] = useState<ConnectionLogEntry[]>([])
  // Keep the current pairing milestones available while React commits the
  // copied connection-log presentation.
  const logsRef = useRef<ConnectionLogEntry[]>([])
  const mountedRef = useRef(true)

  const routeState = resolvePairConfirmRouteState(params.code)
  const offer = routeState.offer
  const resolvedStatus =
    status === 'awaiting-confirm' && routeState.kind === 'error' ? 'error' : status
  const resolvedErrorMessage =
    status === 'awaiting-confirm' && routeState.kind === 'error'
      ? routeState.errorMessage
      : errorMessage

  const cancel = useCallback(() => {
    router.replace('/')
  }, [router])

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        cancel()
        return true
      })
      return () => subscription.remove()
    }, [cancel])
  )

  const setPairConfirmRootRef = useCallback((node: View | null): void => {
    if (node !== null) {
      mountedRef.current = true
      return
    }
    // Ignore the result if navigation detaches the confirmation route.
    mountedRef.current = false
  }, [])

  async function confirm() {
    if (!offer) {
      return
    }
    setStatus('connecting')
    const startedAt = Date.now()
    logsRef.current = [
      {
        id: `pair-${startedAt}`,
        ts: startedAt,
        level: 'info',
        message: 'Opening encrypted Symphony channel',
        detail: offer.endpoint
      }
    ]
    setLogs(logsRef.current)
    try {
      await pairHostOffer(offer, saveHostProfile)
      if (!mountedRef.current) {
        return
      }
      const verifiedAt = Date.now()
      logsRef.current = [
        ...logsRef.current,
        {
          id: `verified-${verifiedAt}`,
          ts: verifiedAt,
          level: 'success',
          message: 'Host identity verified',
          detail: `${offer.hostName} · Symphony`
        }
      ]
      setLogs(logsRef.current)
      router.replace(`/h/${offer.hostId}`)
    } catch (err) {
      if (!mountedRef.current) {
        return
      }
      const rawMessage = err instanceof Error ? err.message : 'Cannot connect to this Symphony host'
      const safeMessage = redactPairingSecrets(rawMessage, offer)
      console.warn('[pair-confirm] connect failed', safeMessage)
      setStatus('error')
      setErrorMessage(
        Date.now() - startedAt >= PAIRING_OVERALL_TIMEOUT_MS
          ? `Couldn't connect within ${PAIRING_OVERALL_TIMEOUT_MS / 1000}s — see log below for where it stalled`
          : safeMessage
      )
    }
  }

  const containerPadding = { paddingTop: insets.top + spacing.sm }

  return (
    <View ref={setPairConfirmRootRef} style={[styles.container, containerPadding]}>
      <Pressable style={styles.backButton} onPress={cancel}>
        <ChevronLeft size={22} color={colors.textSecondary} />
      </Pressable>

      <View style={styles.content}>
        {offer && resolvedStatus === 'awaiting-confirm' && (
          <>
            <Text style={styles.title}>Pair with this Symphony host?</Text>
            <Text style={styles.subtitle}>Dev10x will connect directly to this machine.</Text>
            <View style={styles.actionStack}>
              <Pressable style={styles.primaryButton} onPress={() => void confirm()}>
                <Text style={styles.primaryButtonText}>Pair host</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={cancel}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </>
        )}

        {resolvedStatus === 'connecting' && (
          <>
            <ActivityIndicator size="large" color={colors.textSecondary} />
            <Text style={styles.connectingText}>Connecting…</Text>
            <View style={styles.logSlot}>
              <ConnectionLog entries={logs} title="Pairing log" />
            </View>
          </>
        )}

        {resolvedStatus === 'error' && (
          <>
            <Text style={styles.errorText}>{resolvedErrorMessage}</Text>
            {logs.length > 0 && (
              <View style={styles.logSlot}>
                <ConnectionLog entries={logs} title="Pairing log" />
              </View>
            )}
            <View style={styles.actionStack}>
              <Pressable style={styles.primaryButton} onPress={cancel}>
                <Text style={styles.primaryButtonText}>Back to home</Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    // Why: nudges the centered group slightly above the geometric
    // middle so the eye reads it as visually centered above the home
    // indicator / nav bar.
    paddingBottom: spacing.xl * 2
  },
  title: {
    fontSize: typography.titleSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center'
  },
  subtitle: {
    fontSize: typography.bodySize,
    color: colors.textSecondary,
    lineHeight: 20,
    marginBottom: spacing.xl,
    textAlign: 'center',
    maxWidth: 520,
    alignSelf: 'center'
  },
  actionStack: {
    width: '100%',
    maxWidth: 360,
    alignSelf: 'center'
  },
  primaryButton: {
    width: '100%',
    backgroundColor: colors.textPrimary,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    alignItems: 'center',
    marginBottom: spacing.sm
  },
  primaryButtonText: {
    color: colors.bgBase,
    fontSize: typography.bodySize,
    fontWeight: '600'
  },
  secondaryButton: {
    width: '100%',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.button,
    alignItems: 'center'
  },
  secondaryButtonText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    fontWeight: '500'
  },
  connectingText: {
    color: colors.textSecondary,
    fontSize: typography.bodySize,
    marginTop: spacing.lg,
    textAlign: 'center'
  },
  logSlot: {
    width: '100%',
    marginTop: spacing.lg,
    marginBottom: spacing.md
  },
  errorText: {
    color: colors.statusRed,
    fontSize: typography.bodySize,
    textAlign: 'center',
    marginBottom: spacing.xl,
    lineHeight: 20
  }
})
