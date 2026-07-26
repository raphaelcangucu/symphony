import { View, Text, StyleSheet, Pressable, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  ChevronLeft,
  ChevronRight,
  Info,
  Bell,
  Wrench,
  Shield,
  LifeBuoy,
  Mic,
  Globe,
  LayoutGrid,
  Terminal as TerminalIcon
} from 'lucide-react-native'
import { colors, spacing, typography } from '../src/orca/theme/mobile-theme'
import { useViewMode } from '../src/preferences/ViewModeProvider'

export default function SettingsScreen() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { mode, setMode } = useViewMode()
  const nextMode = mode === 'orca' ? 'codex' : 'orca'

  return (
    <View style={[styles.container, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.topRow}>
        <Pressable
          accessibilityLabel="Back"
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <ChevronLeft size={22} color={colors.textSecondary} />
        </Pressable>
        <Text style={styles.heading}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Pressable
          accessibilityLabel={`Use ${nextMode === 'orca' ? 'Dev10x Workspace' : 'Compact Sessions'} interface`}
          style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          onPress={() => {
            void setMode(nextMode).then(() => router.replace(nextMode === 'orca' ? '/' : '/codex'))
          }}
        >
          <LayoutGrid size={16} color={colors.textSecondary} />
          <Text style={styles.rowLabel}>Interface</Text>
          <Text style={styles.rowValue}>
            {mode === 'orca' ? 'Dev10x Workspace' : 'Compact Sessions'}
          </Text>
          <ChevronRight size={16} color={colors.textMuted} />
        </Pressable>
        <View style={styles.separator} />
        <SettingsRow
          icon={<TerminalIcon size={16} color={colors.textSecondary} />}
          label="Terminal"
          onPress={() => router.push('/terminal-settings')}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<Globe size={16} color={colors.textSecondary} />}
          label="Browser"
          onPress={() => router.push('/browser-settings')}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<Mic size={16} color={colors.textSecondary} />}
          label="Voice"
          onPress={() => router.push('/voice-settings')}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<Bell size={16} color={colors.textSecondary} />}
          label="Notifications"
          onPress={() => router.push('/notifications')}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<Wrench size={16} color={colors.textSecondary} />}
          label="Troubleshooting"
          onPress={() => router.push('/troubleshoot')}
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<Info size={16} color={colors.textSecondary} />}
          label="About"
          onPress={() => router.push('/about')}
        />
      </View>

      <View style={[styles.section, styles.sectionSpacer]}>
        <SettingsRow
          icon={<Shield size={16} color={colors.textSecondary} />}
          label="Source and license"
          showChevron={false}
          onPress={() =>
            void Linking.openURL('https://github.com/raphaelcangucu/symphony')
          }
        />
        <View style={styles.separator} />
        <SettingsRow
          icon={<LifeBuoy size={16} color={colors.textSecondary} />}
          label="Support"
          showChevron={false}
          onPress={() =>
            void Linking.openURL('https://github.com/raphaelcangucu/symphony/issues')
          }
        />
      </View>
    </View>
  )
}

function SettingsRow({
  icon,
  label,
  onPress,
  showChevron = true
}: {
  icon: React.ReactNode
  label: string
  onPress(): void
  showChevron?: boolean
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={onPress}
    >
      {icon}
      <Text style={styles.rowLabel}>{label}</Text>
      {showChevron ? <ChevronRight size={16} color={colors.textMuted} /> : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
    padding: spacing.lg
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xl
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm
  },
  heading: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary
  },
  section: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    overflow: 'hidden'
  },
  sectionSpacer: {
    marginTop: spacing.md
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md + 2
  },
  rowPressed: {
    backgroundColor: colors.bgRaised
  },
  rowLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    fontWeight: '500',
    color: colors.textPrimary
  },
  rowValue: {
    fontSize: typography.metaSize,
    color: colors.textMuted
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
    marginHorizontal: spacing.md
  }
})
