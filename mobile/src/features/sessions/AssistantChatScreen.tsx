import { useExternalStoreRuntime } from "@assistant-ui/core/react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type ThreadMessage,
  type ThreadMessageLike,
  useAui,
  useAuiState,
} from "@assistant-ui/react-native";
import {
  ArrowLeft,
  Brain,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Compass,
  Files,
  Hammer,
  Info,
  ListChecks,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  SendHorizontal,
  ShieldAlert,
  SquareTerminal,
  Target,
  Trash2,
  Zap,
} from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ConnectionBadge,
  type ConnectionState,
} from "@/components/ConnectionBadge";
import { StatusDot } from "@/components/StatusDot";
import type { DictationSession } from "@/native/dictation";
import { radii, spacing } from "@/theme/tokens";
import { useAppTheme } from "@/theme/ThemeProvider";
import type { AssistantCatalog, PromptTemplate } from "@/api/contracts";
import type { HostAssistantCatalogStatus } from "@/runtime/host-assistant-catalog-cache";
import type { SourceChangeSummary } from "@/features/source-control/source-change-summary";

import {
  buildAssistantUiMessages,
  submitAssistantUiMessage,
} from "./assistant-ui-session-adapter";
import { followLatestMessage } from "./chat-scroll";
import {
  MOBILE_COMPOSER_ACTIONS,
  type MobileComposerActionId,
} from "./mobile-composer-actions";
import {
  taskCreationActivity,
  type TaskCreationActivity as TaskCreationDetails,
} from "./task-creation-activity";
import type {
  AssistantApprovalRequest,
  AssistantExecutionMode,
  AssistantGoalStatus,
  AssistantTurnPreferences,
  AssistantUserInputRequest,
  SessionTimelineState,
} from "./session-reducer";

export type AssistantChatScreenProps = {
  catalog: AssistantCatalog | null;
  catalogStatus?: HostAssistantCatalogStatus;
  title: string;
  threadId: number;
  timeline: SessionTimelineState;
  onBack(): void;
  onOpenTerminal(): void;
  onOpenChanges?: (() => void) | undefined;
  sourceChanges?: SourceChangeSummary | null | undefined;
  onOpenEvidenceLink?: ((href: string) => boolean) | undefined;
  taskLinks?:
    | {
        identifier: string;
        onOpenEvidence(): void;
        onOpenPullRequest(): void;
        onOpenTask(): void;
      }
    | undefined;
  onDictate?: (() => Promise<string>) | undefined;
  onStartDictation?: (() => Promise<DictationSession>) | undefined;
  onApproval(
    requestId: string | number,
    action: "approve" | "cancel",
  ): Promise<void>;
  onResumeTurn(): Promise<void>;
  onKillTool(toolCallId: string): Promise<void>;
  onSetTurnPreferences(
    preferences: Partial<AssistantTurnPreferences>,
  ): Promise<void>;
  onLoadMagic?: (() => Promise<PromptTemplate[]>) | undefined;
  onRunMagic?: ((template: PromptTemplate) => Promise<void>) | undefined;
  onSearchContext?:
    ((query: string) => Promise<MobileContextOption[]>) | undefined;
  onSetGoalMode(enabled: boolean, objective?: string): Promise<void>;
  onPauseGoal(): Promise<void>;
  onResumeGoal(): Promise<void>;
  onClearGoal(): Promise<void>;
  onSetGoalObjective(objective: string): Promise<void>;
  onSend(message: string, contextRefs?: MobileContextRef[]): Promise<void>;
  onStopTurn(): Promise<void>;
  onSubmitUserInput(
    requestId: string | number,
    answers: Record<string, string>,
  ): Promise<void>;
  onRetrySeed?: (() => Promise<void>) | undefined;
};

export type MobileContextOption = {
  type: "issue" | "file" | "pr";
  id: string;
  label?: string;
  detail?: string;
};

export type MobileContextRef = Pick<MobileContextOption, "type" | "id">;

export function AssistantChatScreen(props: AssistantChatScreenProps) {
  const [contextRefs, setContextRefs] = useState<MobileContextRef[]>([]);
  const messages = useMemo(
    () => buildAssistantUiMessages(props.timeline),
    [props.timeline],
  );
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages,
    convertMessage: (message) => message,
    // Symphony accepts a new message while a turn is running and routes it as
    // provider steer (or a durable queued follow-up). Keep the composer live.
    isRunning: false,
    isSendDisabled: props.timeline.connectionState !== "live",
    onNew: (message) =>
      submitAssistantUiMessage(message, (text) =>
        props.onSend(text, contextRefs).then(() => setContextRefs([])),
      ),
    onCancel: props.onStopTurn,
    onResume: async () => props.onResumeTurn(),
    unstable_capabilities: { copy: true },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantChatContent
        {...props}
        contextRefs={contextRefs}
        onChangeContextRefs={setContextRefs}
      />
    </AssistantRuntimeProvider>
  );
}

function AssistantChatContent({
  title,
  threadId,
  timeline,
  catalog,
  catalogStatus = "idle",
  onApproval,
  onBack,
  onDictate,
  onStartDictation,
  onOpenTerminal,
  onOpenChanges,
  onOpenEvidenceLink,
  sourceChanges,
  taskLinks,
  onKillTool,
  onSetTurnPreferences,
  onLoadMagic,
  onRunMagic,
  onSearchContext,
  onSetGoalMode,
  onPauseGoal,
  onResumeGoal,
  onClearGoal,
  onSetGoalObjective,
  onResumeTurn,
  onRetrySeed,
  onStopTurn,
  onSubmitUserInput,
  contextRefs,
  onChangeContextRefs,
}: AssistantChatScreenProps & {
  contextRefs: MobileContextRef[];
  onChangeContextRefs(refs: MobileContextRef[]): void;
}) {
  const { colors } = useAppTheme();
  const messageList = useRef<FlatList<ThreadMessage>>(null);
  const [goalEditRequest, setGoalEditRequest] = useState(0);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.bgBase }]}>
      <KeyboardAvoidingView
        // Android edge-to-edge windows do not reliably shrink a nested chat
        // tree on their own. Use an explicit height adjustment so the
        // composer always remains above the IME instead of being covered by it.
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.safeArea}
      >
        <View
          style={[
            styles.header,
            {
              backgroundColor: colors.bgPanel,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          <Pressable
            accessibilityLabel="Go back"
            accessibilityRole="button"
            onPress={onBack}
            style={[styles.iconButton, { backgroundColor: colors.bgPressed }]}
          >
            <ArrowLeft color={colors.textPrimary} size={22} />
          </Pressable>
          <View style={styles.titleBlock}>
            <Text
              numberOfLines={1}
              style={[styles.title, { color: colors.textPrimary }]}
            >
              {title || `Session ${threadId}`}
            </Text>
            <View style={styles.titleMeta}>
              <Text style={[styles.sessionId, { color: colors.textMuted }]}>
                #{threadId}
              </Text>
              <ConnectionBadge state={sessionHeaderState(timeline)} />
            </View>
          </View>
          <TurnControl
            onResumeTurn={onResumeTurn}
            onStopTurn={onStopTurn}
            turnStatus={timeline.turnStatus}
          />
          <Pressable
            accessibilityLabel="Open terminal"
            accessibilityRole="button"
            onPress={onOpenTerminal}
            style={[styles.iconButton, { backgroundColor: colors.bgPressed }]}
          >
            <SquareTerminal color={colors.textPrimary} size={21} />
          </Pressable>
          {sourceChanges && onOpenChanges ? (
            <Pressable
              accessibilityLabel={`Open Changes: ${sourceChanges.filesChanged} files, ${sourceChanges.additions} additions, ${sourceChanges.deletions} deletions`}
              accessibilityRole="button"
              onPress={onOpenChanges}
              style={[styles.iconButton, { backgroundColor: colors.bgPressed }]}
            >
              <Files color={colors.textPrimary} size={20} />
              <Text style={[styles.changeCount, { color: colors.accent }]}>
                {sourceChanges.filesChanged}
              </Text>
            </Pressable>
          ) : null}
          {taskLinks ? (
            <Pressable
              accessibilityLabel={`Open ${taskLinks.identifier} task`}
              accessibilityRole="button"
              onPress={taskLinks.onOpenTask}
              style={[styles.taskLink, { backgroundColor: colors.bgPressed }]}
            >
              <ListChecks color={colors.textPrimary} size={20} />
              <Text numberOfLines={1} style={[styles.taskLinkText, { color: colors.textPrimary }]}>
                {taskLinks.identifier}
              </Text>
            </Pressable>
          ) : null}
        </View>

        <ThreadPrimitive.Root style={styles.thread}>
          <ThreadPrimitive.Messages
            contentContainerStyle={styles.messageListContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => followLatestMessage(messageList.current)}
            ref={messageList}
            testID="session-message-list"
          >
            {({ message }) => (
              <ChatMessage
                onKillTool={onKillTool}
                onOpenEvidenceLink={onOpenEvidenceLink}
                role={message.role}
              />
            )}
          </ThreadPrimitive.Messages>
        </ThreadPrimitive.Root>

        {timeline.pendingApproval ? (
          <ApprovalCard
            onApproval={onApproval}
            request={timeline.pendingApproval}
          />
        ) : null}
        {timeline.pendingUserInput ? (
          <UserInputCard
            onSubmit={onSubmitUserInput}
            request={timeline.pendingUserInput}
          />
        ) : null}

        {timeline.error ? (
          <View style={styles.errorRow}>
            <Text
              accessibilityRole="alert"
              style={[styles.error, { color: colors.statusRed }]}
            >
              {timeline.error}
            </Text>
            {onRetrySeed ? (
              <Pressable
                accessibilityLabel="Retry first message"
                accessibilityRole="button"
                onPress={() => void onRetrySeed()}
              >
                <Text style={[styles.retry, { color: colors.accent }]}>
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <QueuedMessageDock queue={timeline.turnStatus?.queuedMessages ?? []} />

        <GoalDock
          editRequest={goalEditRequest}
          goal={timeline.goal}
          onClear={onClearGoal}
          onPause={onPauseGoal}
          onResume={onResumeGoal}
          onSetGoalMode={onSetGoalMode}
          onSetObjective={onSetGoalObjective}
        />
        <ChatComposer
          catalog={catalog}
          catalogStatus={catalogStatus}
          onDictate={onDictate}
          onStartDictation={onStartDictation}
          onOpenGoal={() => setGoalEditRequest((current) => current + 1)}
          onSetTurnPreferences={onSetTurnPreferences}
          onLoadMagic={onLoadMagic}
          onRunMagic={onRunMagic}
          onSearchContext={onSearchContext}
          contextRefs={contextRefs}
          onChangeContextRefs={onChangeContextRefs}
          preferences={timeline.turnPreferences}
          provider={timeline.metadata.agentKind}
          resolvedEffort={timeline.metadata.resolvedEffort}
          resolvedModel={timeline.metadata.resolvedModel}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function QueuedMessageDock({
  queue,
}: {
  queue: NonNullable<SessionTimelineState["turnStatus"]>["queuedMessages"];
}) {
  const { colors } = useAppTheme();
  if (queue.length === 0) return null;
  const [first, ...rest] = queue;
  return (
    <View
      accessibilityLabel="Queued messages"
      style={[
        styles.queuedDock,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Clock3 color={colors.textMuted} size={15} />
      <View style={styles.queuedCopy}>
        <Text style={[styles.queuedLabel, { color: colors.textSecondary }]}>
          Queued message
        </Text>
        <Text
          numberOfLines={1}
          style={[styles.queuedText, { color: colors.textMuted }]}
        >
          {first.message}
        </Text>
      </View>
      {first.provider ? (
        <Text style={[styles.queuedProvider, { color: colors.accent }]}>
          {first.provider}
        </Text>
      ) : null}
      {rest.length > 0 ? (
        <Text style={[styles.queuedCount, { color: colors.textMuted }]}>
          +{rest.length}
        </Text>
      ) : null}
    </View>
  );
}

function ChatMessage({
  onKillTool,
  onOpenEvidenceLink,
  role,
}: {
  onKillTool(toolCallId: string): Promise<void>;
  onOpenEvidenceLink?: (href: string) => boolean;
  role: "assistant" | "user" | "system";
}) {
  const { colors } = useAppTheme();
  const user = role === "user";
  const system = role === "system";
  return (
    <MessagePrimitive.Root
      testID={`chat-message-${role}`}
      style={[
        styles.message,
        user
          ? styles.userMessage
          : system
            ? styles.activityMessage
            : styles.assistantMessage,
        {
          alignSelf: user ? "flex-end" : "stretch",
          backgroundColor: user ? colors.accentSoft : "transparent",
          borderColor: user ? colors.accent : "transparent",
        },
      ]}
    >
      <MessagePrimitive.Parts
        components={{
          Reasoning: ({ text }: { text: string }) => (
            <ActivityDisclosure icon="reasoning" text={`Thinking\n\n${text}`} />
          ),
          Text: ({ text }: { text: string }) =>
            user ? (
              <Text style={[styles.messageText, { color: colors.textPrimary }]}>
                {text}
              </Text>
            ) : system ? (
              <ActivityDisclosure icon={activityIcon(text)} text={text} />
            ) : (
              <Markdown
                onLinkPress={(href) => !onOpenEvidenceLink?.(href)}
                style={markdownStyles(colors)}
              >
                {text}
              </Markdown>
            ),
          tools: {
            Fallback: (part) => (
              <ToolActivity onKillTool={onKillTool} part={part} />
            ),
          },
          ToolGroup: ({ startIndex, endIndex }) => (
            <ToolActivityGroup
              endIndex={endIndex}
              onKillTool={onKillTool}
              startIndex={startIndex}
            />
          ),
        }}
      />
    </MessagePrimitive.Root>
  );
}

function activityIcon(text: string): "reasoning" | "system" {
  const title = text
    .split(/\n\s*\n/, 1)[0]
    ?.trim()
    .toLowerCase();
  return title === "reasoning" || title === "thinking" ? "reasoning" : "system";
}

function ActivityDisclosure({
  icon,
  text,
}: {
  icon: "reasoning" | "system";
  text: string;
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const { title, body } = disclosureText(
    text,
    icon === "reasoning" ? "Thinking" : "System",
  );
  const Icon = icon === "reasoning" ? Brain : Info;
  const canExpand = body.length > 0;

  return (
    <View style={styles.activityDisclosure}>
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${title} details`}
        accessibilityRole="button"
        disabled={!canExpand}
        onPress={() => setExpanded((current) => !current)}
        style={styles.activityHeader}
      >
        <Icon color={colors.textMuted} size={15} />
        <Text
          numberOfLines={1}
          style={[styles.activityTitle, { color: colors.textSecondary }]}
        >
          {title}
        </Text>
        <Text style={[styles.activityMeta, { color: colors.textMuted }]}>
          {icon === "reasoning" ? "Reasoning" : "System"}
        </Text>
        {canExpand ? (
          expanded ? (
            <ChevronDown color={colors.textMuted} size={15} />
          ) : (
            <ChevronRight color={colors.textMuted} size={15} />
          )
        ) : null}
      </Pressable>
      {expanded && body ? (
        <View
          style={[styles.activityBody, { borderColor: colors.borderSubtle }]}
        >
          <Markdown style={activityMarkdownStyles(colors)}>{body}</Markdown>
        </View>
      ) : null}
    </View>
  );
}

function ToolActivity({
  onKillTool,
  part,
}: {
  onKillTool(toolCallId: string): Promise<void>;
  part: {
    toolCallId?: string;
    toolName: string;
    result?: unknown;
    isError?: boolean;
  };
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const output = part.result === undefined ? "" : String(part.result).trim();
  const running = part.result === undefined;
  const failed = part.isError === true;
  const createdTask = taskCreationActivity(part.toolName, output);

  if (createdTask) {
    return <TaskCreationActivity details={createdTask} running={running} />;
  }

  return (
    <View
      style={[
        styles.toolCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${part.toolName} details`}
        accessibilityRole="button"
        disabled={!output}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolHeader}
      >
        <StatusDot tone={running ? "accent" : failed ? "danger" : "success"} />
        <Text
          numberOfLines={1}
          style={[styles.toolName, { color: colors.textSecondary }]}
        >
          {part.toolName}
        </Text>
        <Text style={[styles.toolStatus, { color: colors.textMuted }]}>
          {running ? "Running" : failed ? "Failed" : "Done"}
        </Text>
        {output ? (
          expanded ? (
            <ChevronDown color={colors.textMuted} size={15} />
          ) : (
            <ChevronRight color={colors.textMuted} size={15} />
          )
        ) : null}
      </Pressable>
      {expanded && output ? (
        <Text
          selectable
          style={[
            styles.toolOutput,
            { borderColor: colors.borderSubtle, color: colors.textSecondary },
          ]}
        >
          {output}
        </Text>
      ) : null}
      {running && part.toolCallId ? (
        <Pressable
          accessibilityLabel={`Stop ${part.toolName}`}
          accessibilityRole="button"
          onPress={() => void onKillTool(part.toolCallId!)}
          style={styles.killTool}
        >
          <Text style={[styles.killToolText, { color: colors.statusRed }]}>
            Stop
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

type ToolTimelineEntry = {
  id: string;
  name: string;
  output: string | null;
  running: boolean;
  failed: boolean;
};

function ToolActivityGroup({
  endIndex,
  onKillTool,
  startIndex,
}: {
  endIndex: number;
  onKillTool(toolCallId: string): Promise<void>;
  startIndex: number;
}) {
  const content = useAuiState((state) => state.message.content);
  const tools = useMemo(
    () =>
      content
        .slice(startIndex, endIndex + 1)
        .flatMap((part) =>
          isToolCallPart(part) ? [toToolTimelineEntry(part)] : [],
        ),
    [content, endIndex, startIndex],
  );
  return <ToolTimelineGroup onKillTool={onKillTool} tools={tools} />;
}

function ToolTimelineGroup({
  onKillTool,
  tools,
}: {
  onKillTool(toolCallId: string): Promise<void>;
  tools: ToolTimelineEntry[];
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const status = toolGroupStatus(tools);
  const summary = toolGroupSummary(tools);
  const detailsLabel = `${expanded ? "Hide" : "Show"} ${tools.length} activity details`;

  return (
    <View
      accessibilityLabel={summary}
      style={[
        styles.toolGroup,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Pressable
        accessibilityLabel={detailsLabel}
        accessibilityRole="button"
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolGroupHeader}
      >
        <StatusDot tone={status.tone} />
        <Text
          numberOfLines={1}
          style={[styles.toolGroupTitle, { color: colors.textSecondary }]}
        >
          {summary}
        </Text>
        <Text style={[styles.toolStatus, { color: colors.textMuted }]}>
          {status.label}
        </Text>
        {expanded ? (
          <ChevronDown color={colors.textMuted} size={15} />
        ) : (
          <ChevronRight color={colors.textMuted} size={15} />
        )}
      </Pressable>
      {expanded ? (
        <View
          style={[
            styles.toolGroupDetails,
            { borderColor: colors.borderSubtle },
          ]}
        >
          {tools.map((tool) => (
            <ToolTimelineDetail
              key={tool.id}
              onKillTool={onKillTool}
              tool={tool}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ToolTimelineDetail({
  onKillTool,
  tool,
}: {
  onKillTool(toolCallId: string): Promise<void>;
  tool: ToolTimelineEntry;
}) {
  const { colors } = useAppTheme();
  const [expanded, setExpanded] = useState(false);
  const canExpand = Boolean(tool.output);
  const label = tool.running ? "Running" : tool.failed ? "Failed" : "Done";
  return (
    <View style={styles.toolDetail}>
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} ${tool.name} details`}
        accessibilityRole="button"
        disabled={!canExpand}
        onPress={() => setExpanded((current) => !current)}
        style={styles.toolDetailHeader}
      >
        <StatusDot
          tone={tool.running ? "accent" : tool.failed ? "danger" : "success"}
          size={6}
        />
        <Text
          numberOfLines={1}
          style={[styles.toolDetailName, { color: colors.textSecondary }]}
        >
          {tool.name}
        </Text>
        <Text style={[styles.toolStatus, { color: colors.textMuted }]}>
          {label}
        </Text>
        {canExpand ? (
          expanded ? (
            <ChevronDown color={colors.textMuted} size={14} />
          ) : (
            <ChevronRight color={colors.textMuted} size={14} />
          )
        ) : null}
      </Pressable>
      {expanded && tool.output ? (
        <Text
          selectable
          style={[
            styles.toolOutput,
            { borderColor: colors.borderSubtle, color: colors.textSecondary },
          ]}
        >
          {tool.output}
        </Text>
      ) : null}
      {tool.running ? (
        <Pressable
          accessibilityLabel={`Stop ${tool.name}`}
          accessibilityRole="button"
          onPress={() => void onKillTool(tool.id)}
          style={styles.killTool}
        >
          <Text style={[styles.killToolText, { color: colors.statusRed }]}>
            Stop
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function isToolCallPart(part: unknown): part is {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  result?: unknown;
  isError?: boolean;
} {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as { type?: unknown }).type === "tool-call" &&
    typeof (part as { toolCallId?: unknown }).toolCallId === "string" &&
    typeof (part as { toolName?: unknown }).toolName === "string"
  );
}

function toToolTimelineEntry(part: {
  toolCallId: string;
  toolName: string;
  result?: unknown;
  isError?: boolean;
}): ToolTimelineEntry {
  return {
    id: part.toolCallId,
    name: part.toolName,
    output: part.result === undefined ? null : String(part.result).trim(),
    running: part.result === undefined,
    failed: part.isError === true,
  };
}

function toolGroupStatus(tools: ToolTimelineEntry[]): {
  label: "Running" | "Failed" | "Done";
  tone: "accent" | "danger" | "success";
} {
  if (tools.some((tool) => tool.running))
    return { label: "Running", tone: "accent" };

  // A durable assistant message exists only after the Host has completed the
  // turn. Individual commands can still have failed while the provider
  // recovered (for example an expected red test before the implementation).
  // Keep those failures visible inside the disclosure, but do not turn a
  // successful final response into a red, misleading session-level failure.
  return { label: "Done", tone: "success" };
}

function toolGroupSummary(tools: ToolTimelineEntry[]): string {
  const counts = tools.reduce(
    (summary, tool) => {
      const category = toolCategory(tool.name);
      summary[category] += 1;
      return summary;
    },
    { commands: 0, edits: 0, reads: 0, other: 0 },
  );
  const fragments = [
    counts.edits
      ? `${counts.edits} ${counts.edits === 1 ? "alteração" : "alterações"}`
      : null,
    counts.commands
      ? `${counts.commands} ${counts.commands === 1 ? "comando" : "comandos"}`
      : null,
    counts.reads
      ? `${counts.reads} ${counts.reads === 1 ? "leitura" : "leituras"}`
      : null,
    counts.other
      ? `${counts.other} ${counts.other === 1 ? "atividade" : "atividades"}`
      : null,
  ].filter((value): value is string => Boolean(value));
  const recoveredFailures = tools.filter((tool) => tool.failed).length;
  const recovery = recoveredFailures
    ? `${recoveredFailures} ${recoveredFailures === 1 ? "falha recuperada" : "falhas recuperadas"}`
    : null;
  return fragments.length === 1
    ? [fragments[0]!, recovery].filter(Boolean).join(" · ")
    : [
        `${tools.length} atividades · ${fragments.slice(0, 2).join(" · ")}`,
        recovery,
      ]
        .filter(Boolean)
        .join(" · ");
}

function toolCategory(name: string): "commands" | "edits" | "reads" | "other" {
  const normalized = name.toLowerCase();
  if (/(apply_patch|write|edit|create_file|replace)/.test(normalized))
    return "edits";
  if (/(shell|exec|command|terminal|run)/.test(normalized)) return "commands";
  if (/(read|search|find|list|workflow)/.test(normalized)) return "reads";
  return "other";
}

function TaskCreationActivity({
  details,
  running,
}: {
  details: TaskCreationDetails;
  running: boolean;
}) {
  const { colors } = useAppTheme();
  const label = running
    ? "Creating task"
    : details.kind === "draft"
      ? "Draft created"
      : details.kind === "subtask"
        ? "Subtask created"
        : "Task created";
  const description = running
    ? "Creating a tracker task…"
    : (details.title ??
      (details.parentIdentifier
        ? `${details.unitType ?? "child"} of ${details.parentIdentifier}`
        : "Added to this project"));
  return (
    <View
      style={[
        styles.taskCreationCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <ListChecks color={colors.accent} size={18} />
      <View style={styles.taskCreationCopy}>
        <Text style={[styles.taskCreationLabel, { color: colors.textPrimary }]}>
          {label}
        </Text>
        <Text
          numberOfLines={2}
          style={[styles.taskCreationDescription, { color: colors.textMuted }]}
        >
          {description}
        </Text>
      </View>
      {details.identifier ? (
        <Text style={[styles.taskCreationIdentifier, { color: colors.accent }]}>
          {details.identifier}
        </Text>
      ) : (
        <ActivityIndicator color={colors.accent} size="small" />
      )}
    </View>
  );
}

function disclosureText(
  text: string,
  fallbackTitle: string,
): { title: string; body: string } {
  const trimmed = text.trim();
  if (!trimmed) return { title: fallbackTitle, body: "" };
  const divider = trimmed.search(/\n\s*\n/);
  if (divider < 0) return { title: trimmed, body: "" };
  return {
    title: trimmed.slice(0, divider).trim() || fallbackTitle,
    body: trimmed.slice(divider).trim(),
  };
}

function ChatComposer({
  catalog,
  catalogStatus,
  onDictate,
  onStartDictation,
  onOpenGoal,
  onSetTurnPreferences,
  onLoadMagic,
  onRunMagic,
  onSearchContext,
  preferences,
  provider,
  resolvedEffort,
  resolvedModel,
  contextRefs,
  onChangeContextRefs,
}: {
  catalog: AssistantCatalog | null;
  catalogStatus: HostAssistantCatalogStatus;
  onDictate?: (() => Promise<string>) | undefined;
  onStartDictation?: (() => Promise<DictationSession>) | undefined;
  onOpenGoal(): void;
  onSetTurnPreferences(
    preferences: Partial<AssistantTurnPreferences>,
  ): Promise<void>;
  onLoadMagic?: (() => Promise<PromptTemplate[]>) | undefined;
  onRunMagic?: ((template: PromptTemplate) => Promise<void>) | undefined;
  onSearchContext?:
    ((query: string) => Promise<MobileContextOption[]>) | undefined;
  preferences: AssistantTurnPreferences;
  provider: string | null;
  resolvedEffort: string | null;
  resolvedModel: string | null;
  contextRefs: MobileContextRef[];
  onChangeContextRefs(refs: MobileContextRef[]): void;
}) {
  const { colors } = useAppTheme();
  const [dictating, setDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const activeDictation = useRef<DictationSession | null>(null);
  const [settings, setSettings] = useState<"none" | "permission" | "model">(
    "none",
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionView, setActionView] = useState<"menu" | "magic" | "context">(
    "menu",
  );
  const [actionQuery, setActionQuery] = useState("");
  const [magicTemplates, setMagicTemplates] = useState<PromptTemplate[]>([]);
  const [contextOptions, setContextOptions] = useState<MobileContextOption[]>(
    [],
  );
  const [actionLoading, setActionLoading] = useState(false);
  const actionSearchInput = useRef<TextInput>(null);
  const aui = useAui();
  const composerText = useAuiState((state) => state.composer.text);
  const selectedAgent =
    catalog?.agents.find(
      (agent) => agent.agent.toLowerCase() === provider?.toLowerCase(),
    ) ??
    catalog?.agents.find((agent) => agent.agent === catalog.defaultAgent) ??
    null;
  const activeModel =
    preferences.model ?? resolvedModel ?? selectedAgent?.defaultModel ?? null;
  const selectedModel =
    selectedAgent?.models.find((model) => model.model === activeModel) ?? null;
  const modelLabel = composerModelLabel(
    selectedModel?.label ?? activeModel,
    preferences.effort ?? resolvedEffort,
  );

  useEffect(() => {
    return () => {
      activeDictation.current?.cancel();
      activeDictation.current = null;
    };
  }, []);

  const appendDictation = (transcript: string) => {
    const nextText = [composerText.trim(), transcript.trim()]
      .filter(Boolean)
      .join(" ");
    if (nextText) aui.composer().setText(nextText);
  };

  const beginDictation = () => {
    if (activeDictation.current) {
      activeDictation.current.stop();
      return;
    }
    if (!onStartDictation && !onDictate) return;
    setDictating(true);
    setDictationError(null);
    if (!onStartDictation) {
      void onDictate!()
        .then(appendDictation)
        .catch((cause) =>
          setDictationError(
            cause instanceof Error
              ? cause.message
              : "Could not recognize speech",
          ),
        )
        .finally(() => setDictating(false));
      return;
    }
    void onStartDictation()
      .then((session) => {
        activeDictation.current = session;
        return session.result;
      })
      .then(appendDictation)
      .catch((cause) => {
        const message =
          cause instanceof Error ? cause.message : "Could not recognize speech";
        if (message !== "Dictation cancelled") setDictationError(message);
      })
      .finally(() => {
        activeDictation.current = null;
        setDictating(false);
      });
  };

  const runComposerAction = (action: MobileComposerActionId) => {
    if (action === "plan") {
      void onSetTurnPreferences({ executionMode: "plan" }).then(() =>
        setActionsOpen(false),
      );
      return;
    }
    if (action === "magic" && onLoadMagic) {
      setActionView("magic");
      setActionQuery("");
      setActionLoading(true);
      void onLoadMagic()
        .then(setMagicTemplates)
        .finally(() => setActionLoading(false));
      return;
    }
    if (action === "context" && onSearchContext) {
      setActionView("context");
      setActionQuery("");
      setContextOptions([]);
      return;
    }
    setActionsOpen(false);
    if (action === "goal") onOpenGoal();
  };
  const filteredMagicTemplates = magicTemplates.filter((template) => {
    const query = actionQuery.trim().toLowerCase();
    if (!query) return true;
    return [
      template.name,
      template.description,
      template.category,
      template.agentKind,
      template.mode,
    ]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(query));
  });
  const contextGroups = [
    { type: "issue" as const, label: "Issues" },
    { type: "file" as const, label: "Files" },
    { type: "pr" as const, label: "Pull requests" },
  ];

  return (
    <View style={styles.composerShell}>
      <Modal
        animationType="slide"
        onRequestClose={() => setActionsOpen(false)}
        transparent
        visible={actionsOpen}
      >
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.actionSheetKeyboard}
        >
          <Pressable
            accessibilityLabel="Close composer actions"
            onPress={() => setActionsOpen(false)}
            style={styles.actionSheetBackdrop}
          >
            <Pressable
              accessible={false}
              onPress={(event) => event.stopPropagation()}
              style={[
                styles.actionSheet,
                {
                  backgroundColor: colors.bgPanel,
                  borderColor: colors.borderStrong,
                },
              ]}
            >
              <View
                style={[
                  styles.actionSheetHandle,
                  { backgroundColor: colors.borderStrong },
                ]}
              />
              <View style={styles.actionSheetHeader}>
                {actionView !== "menu" ? (
                  <Pressable
                    accessibilityLabel="Back to composer actions"
                    accessibilityRole="button"
                    onPress={() => {
                      setActionView("menu");
                      setActionQuery("");
                    }}
                    style={styles.actionSheetHeaderButton}
                  >
                    <ChevronLeft color={colors.textSecondary} size={21} />
                  </Pressable>
                ) : (
                  <View style={styles.actionSheetHeaderButton} />
                )}
                <View style={styles.actionSheetHeading}>
                  <Text
                    style={[
                      styles.actionSheetTitle,
                      { color: colors.textPrimary },
                    ]}
                  >
                    {actionView === "menu"
                      ? "Add to session"
                      : actionView === "magic"
                        ? "Magic"
                        : "Add context"}
                  </Text>
                  <Text
                    style={[
                      styles.actionSheetSubtitle,
                      { color: colors.textMuted },
                    ]}
                  >
                    {actionView === "menu"
                      ? "Choose what this turn needs"
                      : actionView === "magic"
                        ? "Run a reusable workflow"
                        : "Attach live project references"}
                  </Text>
                </View>
                <Pressable
                  accessibilityLabel="Done with composer actions"
                  accessibilityRole="button"
                  onPress={() => setActionsOpen(false)}
                  style={styles.actionSheetHeaderButton}
                >
                  <Text style={{ color: colors.accent, fontWeight: "700" }}>
                    Done
                  </Text>
                </Pressable>
              </View>
              {actionView === "context" || actionView === "magic" ? (
                <TextInput
                  accessibilityLabel={
                    actionView === "magic" ? "Search magic" : "Search context"
                  }
                  onChangeText={(query) => {
                    setActionQuery(query);
                    if (actionView === "context") {
                      setActionLoading(true);
                      void onSearchContext?.(query)
                        .then(setContextOptions)
                        .finally(() => setActionLoading(false));
                    }
                  }}
                  placeholder={
                    actionView === "magic"
                      ? "Search workflows"
                      : "Search issues, files, and PRs"
                  }
                  placeholderTextColor={colors.textMuted}
                  ref={actionSearchInput}
                  style={[
                    styles.actionSearch,
                    {
                      backgroundColor: colors.bgBase,
                      borderColor: colors.borderStrong,
                      color: colors.textPrimary,
                    },
                  ]}
                  value={actionQuery}
                />
              ) : null}
              <ScrollView
                contentContainerStyle={styles.actionSheetContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {actionLoading ? (
                  <ActivityIndicator color={colors.accent} />
                ) : null}
                {actionView === "menu"
                  ? MOBILE_COMPOSER_ACTIONS.map((action) => (
                      <Pressable
                        accessibilityRole="button"
                        key={action.id}
                        onPress={() => runComposerAction(action.id)}
                        style={({ pressed }) => [
                          styles.actionSheetRow,
                          {
                            backgroundColor: pressed
                              ? colors.bgPressed
                              : "transparent",
                          },
                        ]}
                      >
                        <View
                          style={[
                            styles.actionIcon,
                            { backgroundColor: colors.accentSoft },
                          ]}
                        >
                          <ComposerActionIcon
                            color={colors.accent}
                            id={action.id}
                          />
                        </View>
                        <View style={styles.actionSheetCopy}>
                          <Text
                            style={{
                              color: colors.textPrimary,
                              fontWeight: "700",
                            }}
                          >
                            {action.label}
                          </Text>
                          <Text style={{ color: colors.textMuted }}>
                            {action.description}
                          </Text>
                        </View>
                        <ChevronRight color={colors.textMuted} size={18} />
                      </Pressable>
                    ))
                  : null}
                {actionView === "magic"
                  ? filteredMagicTemplates.map((template) => (
                      <Pressable
                        accessibilityLabel={`Run ${template.name}`}
                        accessibilityRole="button"
                        key={template.id}
                        onPress={() => {
                          setActionLoading(true);
                          void onRunMagic?.(template).finally(() => {
                            setActionLoading(false);
                            setActionsOpen(false);
                            setActionView("menu");
                          });
                        }}
                        style={({ pressed }) => [
                          styles.magicCard,
                          {
                            backgroundColor: pressed
                              ? colors.bgPressed
                              : colors.bgBase,
                            borderColor: colors.borderSubtle,
                          },
                        ]}
                      >
                        <View style={styles.magicHeading}>
                          <Text
                            style={[
                              styles.magicCategory,
                              {
                                backgroundColor: colors.accentSoft,
                                color: colors.accent,
                              },
                            ]}
                          >
                            {template.category || "Workflow"}
                          </Text>
                          <Text
                            style={{ color: colors.textMuted, fontSize: 12 }}
                          >
                            {[
                              displayName(template.agentKind),
                              displayName(template.mode),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        </View>
                        <View style={styles.magicCopy}>
                          <Text
                            style={[
                              styles.magicTitle,
                              { color: colors.textPrimary },
                            ]}
                          >
                            {template.name}
                          </Text>
                          {template.description ? (
                            <Text
                              style={[
                                styles.magicDescription,
                                { color: colors.textMuted },
                              ]}
                            >
                              {template.description}
                            </Text>
                          ) : null}
                        </View>
                        <View style={styles.magicRun}>
                          <Text
                            style={{ color: colors.accent, fontWeight: "700" }}
                          >
                            Run workflow
                          </Text>
                          <ChevronRight color={colors.accent} size={18} />
                        </View>
                      </Pressable>
                    ))
                  : null}
                {actionView === "context"
                  ? contextGroups.map((group) => {
                      const options = contextOptions.filter(
                        (option) => option.type === group.type,
                      );
                      if (options.length === 0) return null;
                      return (
                        <View key={group.type} style={styles.contextGroup}>
                          <Text
                            style={[
                              styles.contextGroupTitle,
                              { color: colors.textMuted },
                            ]}
                          >
                            {group.label}
                          </Text>
                          {options.map((option) => (
                            <Pressable
                              accessibilityLabel={`Add ${option.type} ${option.id}`}
                              accessibilityRole="button"
                              key={`${option.type}:${option.id}`}
                              onPress={() => {
                                if (
                                  !contextRefs.some(
                                    (ref) =>
                                      ref.type === option.type &&
                                      ref.id === option.id,
                                  )
                                ) {
                                  onChangeContextRefs([
                                    ...contextRefs,
                                    { type: option.type, id: option.id },
                                  ]);
                                }
                                actionSearchInput.current?.blur();
                                Keyboard.dismiss();
                                setTimeout(() => {
                                  setActionsOpen(false);
                                  setActionView("menu");
                                }, 250);
                              }}
                              style={({ pressed }) => [
                                styles.contextRow,
                                {
                                  backgroundColor: pressed
                                    ? colors.bgPressed
                                    : colors.bgBase,
                                  borderColor: colors.borderSubtle,
                                },
                              ]}
                            >
                              <View
                                style={[
                                  styles.contextType,
                                  { backgroundColor: colors.accentSoft },
                                ]}
                              >
                                <Text
                                  style={{
                                    color: colors.accent,
                                    fontSize: 11,
                                    fontWeight: "800",
                                  }}
                                >
                                  {option.type.toUpperCase()}
                                </Text>
                              </View>
                              <View style={styles.actionSheetCopy}>
                                <Text
                                  style={{
                                    color: colors.textPrimary,
                                    fontWeight: "700",
                                  }}
                                >
                                  {option.id}
                                </Text>
                                {option.label ? (
                                  <Text style={{ color: colors.textMuted }}>
                                    {option.label}
                                  </Text>
                                ) : null}
                              </View>
                              <Plus color={colors.textSecondary} size={18} />
                            </Pressable>
                          ))}
                        </View>
                      );
                    })
                  : null}
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      {settings !== "none" ? (
        <View style={styles.settingsOverlay}>
          <ComposerSettings
            catalog={catalog}
            catalogStatus={catalogStatus}
            mode={settings}
            onClose={() => setSettings("none")}
            onSetTurnPreferences={onSetTurnPreferences}
            preferences={preferences}
            provider={provider}
          />
        </View>
      ) : null}
      {dictationError ? (
        <Text
          accessibilityRole="alert"
          style={[styles.dictationError, { color: colors.statusRed }]}
        >
          {dictationError}
        </Text>
      ) : null}
      {contextRefs.length > 0 ? (
        <View accessibilityLabel="Selected context" style={styles.contextChips}>
          {contextRefs.map((ref) => (
            <Pressable
              accessibilityLabel={`Remove ${ref.type} ${ref.id}`}
              accessibilityRole="button"
              key={`${ref.type}:${ref.id}`}
              onPress={() =>
                onChangeContextRefs(
                  contextRefs.filter(
                    (candidate) =>
                      candidate.type !== ref.type || candidate.id !== ref.id,
                  ),
                )
              }
              style={[
                styles.contextChip,
                { backgroundColor: colors.bgPressed },
              ]}
            >
              <Text style={{ color: colors.accent, fontWeight: "700" }}>
                {ref.type.toUpperCase()}
              </Text>
              <Text numberOfLines={1} style={{ color: colors.textPrimary }}>
                {ref.id}
              </Text>
              <Text style={{ color: colors.textMuted }}>×</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.composerSurface,
          { backgroundColor: colors.bgPanel, borderColor: colors.borderStrong },
        ]}
      >
        <ComposerPrimitive.Root style={styles.composer}>
          <ComposerPrimitive.Input
            accessibilityLabel="Message"
            multiline
            placeholder="Trabalhar nesta Máquina…"
            placeholderTextColor={colors.textMuted}
            selectionColor={colors.accent}
            style={[styles.input, { color: colors.textPrimary }]}
            submitMode="none"
          />
          <View style={styles.composerActions}>
            <Pressable
              accessibilityLabel="Open composer actions"
              accessibilityRole="button"
              onPress={() => setActionsOpen(true)}
              style={styles.addContextButton}
            >
              <Plus color={colors.textPrimary} size={28} />
            </Pressable>
            <Pressable
              accessibilityLabel={`Choose permissions: ${executionModeLabel(preferences.executionMode)}`}
              accessibilityRole="button"
              onPress={() =>
                setSettings((current) =>
                  current === "permission" ? "none" : "permission",
                )
              }
              style={styles.permissionButton}
            >
              <ShieldAlert
                color={
                  preferences.executionMode === "yolo"
                    ? colors.statusAmber
                    : colors.accent
                }
                size={24}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="Choose model"
              accessibilityRole="button"
              onPress={() =>
                setSettings((current) =>
                  current === "model" ? "none" : "model",
                )
              }
              style={styles.modelChip}
            >
              <Zap
                color={colors.textPrimary}
                fill={colors.textPrimary}
                size={17}
              />
              <Text
                numberOfLines={1}
                style={[styles.modelLabel, { color: colors.textPrimary }]}
              >
                {modelLabel}
              </Text>
              <ChevronDown color={colors.textMuted} size={15} />
            </Pressable>
            <View style={styles.composerSendActions}>
              {onDictate || onStartDictation ? (
                <Pressable
                  accessibilityLabel={
                    dictating ? "Stop dictation" : "Dictate message"
                  }
                  accessibilityRole="button"
                  onPress={beginDictation}
                  style={styles.micButton}
                >
                  {dictating ? (
                    <Text
                      style={[
                        styles.stopDictationLabel,
                        { color: colors.statusRed },
                      ]}
                    >
                      Stop
                    </Text>
                  ) : (
                    <Mic color={colors.textPrimary} size={21} />
                  )}
                </Pressable>
              ) : null}
              <ComposerPrimitive.Send
                accessibilityLabel="Send"
                accessibilityRole="button"
                style={[
                  styles.composerButton,
                  { backgroundColor: colors.textPrimary },
                ]}
              >
                <SendHorizontal color={colors.bgBase} size={20} />
              </ComposerPrimitive.Send>
            </View>
          </View>
        </ComposerPrimitive.Root>
      </View>
    </View>
  );
}

function ComposerActionIcon({
  color,
  id,
}: {
  color: string;
  id: MobileComposerActionId;
}) {
  if (id === "plan") return <ListChecks color={color} size={21} />;
  if (id === "magic") return <Zap color={color} size={21} />;
  if (id === "context") return <Files color={color} size={21} />;
  return <Target color={color} size={21} />;
}

function displayName(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function ComposerSettings({
  catalog,
  catalogStatus,
  mode,
  onClose,
  onSetTurnPreferences,
  preferences,
  provider,
}: {
  catalog: AssistantCatalog | null;
  catalogStatus: HostAssistantCatalogStatus;
  mode: "permission" | "model";
  onClose(): void;
  onSetTurnPreferences(
    preferences: Partial<AssistantTurnPreferences>,
  ): Promise<void>;
  preferences: AssistantTurnPreferences;
  provider: string | null;
}) {
  const { colors } = useAppTheme();
  const [modelForEffort, setModelForEffort] = useState<
    AssistantCatalog["agents"][number]["models"][number] | null
  >(null);
  const agent =
    catalog?.agents.find((candidate) => candidate.agent === provider) ?? null;
  if (mode === "permission") {
    return (
      <View
        style={[
          styles.settingsPanel,
          {
            backgroundColor: colors.bgRaised,
            borderColor: colors.borderStrong,
          },
        ]}
      >
        <SettingsHeader label="Permissions for next turn" onClose={onClose} />
        {(["plan", "build", "yolo"] as AssistantExecutionMode[]).map(
          (executionMode) => (
            <Pressable
              key={executionMode}
              accessibilityLabel={`Use ${executionModeLabel(executionMode)}`}
              accessibilityRole="button"
              onPress={() => {
                void onSetTurnPreferences({ executionMode }).finally(onClose);
              }}
              style={styles.settingsOption}
            >
              <ExecutionModeIcon
                color={colors.textSecondary}
                mode={executionMode}
              />
              <View style={styles.settingsCopy}>
                <Text style={{ color: colors.textPrimary }}>
                  {executionModeLabel(executionMode)}
                </Text>
                <Text
                  style={[
                    styles.settingsDescription,
                    { color: colors.textMuted },
                  ]}
                >
                  {executionModeDescription(executionMode)}
                </Text>
              </View>
              <StatusDot
                tone={
                  preferences.executionMode === executionMode
                    ? "accent"
                    : "muted"
                }
              />
            </Pressable>
          ),
        )}
      </View>
    );
  }

  if (modelForEffort) {
    const activeEffort =
      preferences.model === modelForEffort.model ? preferences.effort : null;

    return (
      <View
        style={[
          styles.settingsPanel,
          {
            backgroundColor: colors.bgRaised,
            borderColor: colors.borderStrong,
          },
        ]}
      >
        <SettingsHeader
          label={`${modelForEffort.label} effort`}
          onBack={() => setModelForEffort(null)}
          onClose={onClose}
        />
        {modelForEffort.efforts.map((effort) => (
          <Pressable
            key={effort.effort}
            accessibilityLabel={`Use ${modelForEffort.label} with ${effort.label} effort`}
            accessibilityRole="button"
            onPress={() => {
              void onSetTurnPreferences({
                model: modelForEffort.model,
                effort: effort.effort,
              }).finally(onClose);
            }}
            style={styles.settingsOption}
          >
            <Brain color={colors.textSecondary} size={16} />
            <View style={styles.settingsCopy}>
              <Text style={{ color: colors.textPrimary }}>{effort.label}</Text>
              <Text
                style={[
                  styles.settingsDescription,
                  { color: colors.textMuted },
                ]}
              >
                Reasoning effort for the next turn
              </Text>
            </View>
            <StatusDot
              tone={activeEffort === effort.effort ? "accent" : "muted"}
            />
          </Pressable>
        ))}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.settingsPanel,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderStrong },
      ]}
    >
      <SettingsHeader
        label={agent ? `${agent.agentLabel} model` : "Model"}
        onClose={onClose}
      />
      {agent?.models.length ? (
        agent.models.map((model) => (
          <Pressable
            key={model.model}
            accessibilityLabel={`Use ${model.label}`}
            accessibilityRole="button"
            onPress={() => {
              if (model.efforts.length > 0) {
                setModelForEffort(model);
                return;
              }

              void onSetTurnPreferences({
                model: model.model,
                effort: null,
              }).finally(onClose);
            }}
            style={styles.settingsOption}
          >
            <Target color={colors.textSecondary} size={16} />
            <View style={styles.settingsCopy}>
              <Text style={{ color: colors.textPrimary }}>{model.label}</Text>
              <Text
                style={[
                  styles.settingsDescription,
                  { color: colors.textMuted },
                ]}
              >
                {model.efforts.find(
                  (entry) => entry.effort === preferences.effort,
                )?.label ??
                  model.efforts[0]?.label ??
                  "Default effort"}
              </Text>
            </View>
            <StatusDot
              tone={preferences.model === model.model ? "accent" : "muted"}
            />
            {model.efforts.length > 0 ? (
              <ChevronRight color={colors.textMuted} size={16} />
            ) : null}
          </Pressable>
        ))
      ) : (
        <Text style={[styles.settingsDescription, { color: colors.textMuted }]}>
          {catalogStatus === "loading" || catalogStatus === "idle"
            ? "Preparing model options for this machine…"
            : catalogStatus === "unavailable"
              ? "Model options are unavailable on this machine. Reconnect it to retry."
              : "This provider has no model choices on this machine."}
        </Text>
      )}
    </View>
  );
}

function SettingsHeader({
  label,
  onBack,
  onClose,
}: {
  label: string;
  onBack?: (() => void) | undefined;
  onClose(): void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.settingsHeader}>
      <View style={styles.settingsHeading}>
        {onBack ? (
          <Pressable
            accessibilityLabel="Back to model list"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onBack}
          >
            <ChevronLeft color={colors.textSecondary} size={20} />
          </Pressable>
        ) : null}
        <Text style={[styles.settingsTitle, { color: colors.textPrimary }]}>
          {label}
        </Text>
      </View>
      <Pressable
        accessibilityLabel="Close settings"
        accessibilityRole="button"
        onPress={onClose}
      >
        <Text style={{ color: colors.accent }}>Done</Text>
      </Pressable>
    </View>
  );
}

function GoalDock({
  editRequest,
  goal,
  onClear,
  onPause,
  onResume,
  onSetGoalMode,
  onSetObjective,
}: {
  editRequest: number;
  goal: AssistantGoalStatus | null;
  onClear(): Promise<void>;
  onPause(): Promise<void>;
  onResume(): Promise<void>;
  onSetGoalMode(enabled: boolean, objective?: string): Promise<void>;
  onSetObjective(objective: string): Promise<void>;
}) {
  const { colors } = useAppTheme();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(goal?.objective ?? "");
  const enabled = goal?.enabled === true;
  const capabilities = goal?.capabilities ?? [];
  const canEdit =
    !goal ||
    capabilities.includes("edit") ||
    capabilities.includes("set_objective");
  const canClear = enabled && capabilities.includes("clear");
  const canPause = enabled && goal?.running && capabilities.includes("pause");
  const canResume =
    enabled &&
    !goal?.running &&
    goal?.resumable &&
    capabilities.includes("resume");
  useEffect(() => {
    if (editRequest > 0 && canEdit) {
      setDraft(goal?.objective ?? "");
      setEditing(true);
    }
  }, [canEdit, editRequest, goal?.objective]);
  const save = () => {
    const objective = draft.trim();
    if (!objective) return;
    const action = enabled
      ? onSetObjective(objective)
      : onSetGoalMode(true, objective);
    void action.then(() => setEditing(false));
  };
  if (!goal || !goal.available || capabilities.length === 0) return null;
  return (
    <View
      style={[
        styles.goalDock,
        { backgroundColor: colors.bgRaised, borderColor: colors.borderSubtle },
      ]}
    >
      <Target color={colors.accent} size={16} />
      <View style={styles.goalCopy}>
        <Text
          numberOfLines={1}
          style={[styles.goalTitle, { color: colors.textPrimary }]}
        >
          {enabled ? "Pursuing goal" : "Set a goal"}
        </Text>
        {!editing ? (
          <View style={styles.goalSummary}>
            <Text
              numberOfLines={1}
              style={[styles.goalObjective, { color: colors.textMuted }]}
            >
              {goal?.objective ?? "Keep this session focused across turns"}
            </Text>
            {enabled && goal.timeUsedSeconds !== null ? (
              <Text style={[styles.goalDuration, { color: colors.textMuted }]}>
                {formatDuration(goal.timeUsedSeconds)}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
      {!editing ? (
        <View style={styles.goalButtons}>
          {canEdit ? (
            <GoalButton
              icon={<Pencil color={colors.textSecondary} size={16} />}
              label="Edit goal"
              onPress={() => {
                setDraft(goal?.objective ?? "");
                setEditing(true);
              }}
            />
          ) : null}
          {canPause ? (
            <GoalButton
              icon={<Pause color={colors.textSecondary} size={16} />}
              label="Pause goal"
              onPress={() => void onPause()}
            />
          ) : null}
          {canResume ? (
            <GoalButton
              icon={<Play color={colors.textSecondary} size={16} />}
              label="Resume goal"
              onPress={() => void onResume()}
            />
          ) : null}
          {canClear ? (
            <GoalButton
              icon={<Trash2 color={colors.statusRed} size={16} />}
              label="Remove goal"
              onPress={() => void onClear()}
            />
          ) : null}
        </View>
      ) : null}
      {editing ? (
        <View style={styles.goalEditor}>
          <TextInput
            accessibilityLabel="Goal objective"
            multiline
            onChangeText={setDraft}
            placeholder="Describe the outcome"
            placeholderTextColor={colors.textMuted}
            style={[
              styles.goalInput,
              { borderColor: colors.borderStrong, color: colors.textPrimary },
            ]}
            value={draft}
          />
          <RequestButton label="Save goal" onPress={save} tone="primary" />
          <RequestButton
            label="Cancel goal edit"
            onPress={() => setEditing(false)}
            tone="secondary"
          />
        </View>
      ) : null}
    </View>
  );
}

function GoalButton({
  icon,
  label,
  onPress,
}: {
  icon: ReactNode;
  label: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.goalButton}
    >
      {icon}
    </Pressable>
  );
}

function ExecutionModeIcon({
  color,
  mode,
}: {
  color: string;
  mode: AssistantExecutionMode;
}) {
  if (mode === "plan") return <Compass color={color} size={16} />;
  if (mode === "build") return <Hammer color={color} size={16} />;
  return <Zap color={color} size={16} />;
}

function executionModeLabel(mode: AssistantExecutionMode | null): string {
  if (mode === "plan") return "Read only";
  if (mode === "build") return "Ask approval";
  if (mode === "yolo") return "Full access";
  return "Permissions";
}

function composerModelLabel(
  model: string | null,
  effort: string | null,
): string {
  const compactModel = model
    ?.replace(/^gpt-/i, "")
    .replace(/-/g, " ")
    .replace(/\bsol\b/i, "Sol")
    .trim();
  const effortLabel =
    effort === "high"
      ? "Alto"
      : effort === "medium"
        ? "Médio"
        : effort === "low"
          ? "Baixo"
          : effort;
  return (
    [compactModel, effortLabel].filter(Boolean).join(" ") || "Selecionar modelo"
  );
}

function executionModeDescription(mode: AssistantExecutionMode): string {
  if (mode === "plan") return "Explore and plan without editing files.";
  if (mode === "build")
    return "Edit the workspace and ask before sensitive actions.";
  return "No prompts; access to machine files and network.";
}

function formatDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safeSeconds / 3_600);
  const minutes = Math.floor((safeSeconds % 3_600) / 60);
  const seconds = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function TurnControl({
  onResumeTurn,
  onStopTurn,
  turnStatus,
}: {
  onResumeTurn(): Promise<void>;
  onStopTurn(): Promise<void>;
  turnStatus: SessionTimelineState["turnStatus"];
}) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const canResume = turnStatus?.canResume === true;
  const canStop = turnStatus?.status === "running";
  if (!canResume && !canStop) return null;
  const label = canResume ? "Resume turn" : "Stop turn";
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={busy}
      onPress={() => {
        setBusy(true);
        void (canResume ? onResumeTurn() : onStopTurn()).finally(() =>
          setBusy(false),
        );
      }}
      style={styles.turnControl}
    >
      <Text
        style={{ color: canResume ? colors.statusGreen : colors.statusRed }}
      >
        {busy ? "…" : canResume ? "Resume" : "Stop"}
      </Text>
    </Pressable>
  );
}

function ApprovalCard({
  onApproval,
  request,
}: {
  onApproval(
    requestId: string | number,
    action: "approve" | "cancel",
  ): Promise<void>;
  request: AssistantApprovalRequest;
}) {
  const { colors } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const decide = async (action: "approve" | "cancel") => {
    if (busy) return;
    setBusy(true);
    try {
      await onApproval(request.requestId, action);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View
      style={[
        styles.requestCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.statusAmber },
      ]}
    >
      <Text style={[styles.requestTitle, { color: colors.statusAmber }]}>
        Approval required
      </Text>
      {request.reason ? (
        <Text style={{ color: colors.textSecondary }}>{request.reason}</Text>
      ) : null}
      {request.command ? (
        <Text style={[styles.command, { color: colors.textPrimary }]}>
          {request.command}
        </Text>
      ) : null}
      <View style={styles.requestActions}>
        <RequestButton
          disabled={busy}
          label="Cancel command"
          onPress={() => void decide("cancel")}
          tone="secondary"
        />
        <RequestButton
          disabled={busy}
          label="Approve command"
          onPress={() => void decide("approve")}
          tone="primary"
        />
      </View>
    </View>
  );
}

function UserInputCard({
  onSubmit,
  request,
}: {
  onSubmit(
    requestId: string | number,
    answers: Record<string, string>,
  ): Promise<void>;
  request: AssistantUserInputRequest;
}) {
  const { colors } = useAppTheme();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const complete = request.questions.every((question) =>
    Boolean(answers[question.id]?.trim()),
  );
  return (
    <View
      style={[
        styles.requestCard,
        { backgroundColor: colors.bgRaised, borderColor: colors.accent },
      ]}
    >
      <Text style={[styles.requestTitle, { color: colors.accent }]}>
        Assistant question
      </Text>
      {request.questions.map((question) => (
        <View key={question.id} style={styles.question}>
          <Text style={{ color: colors.textPrimary }}>{question.question}</Text>
          {question.options?.length ? (
            <View style={styles.requestActions}>
              {question.options.map((option) => (
                <RequestButton
                  key={option.label}
                  label={`Select ${option.label}`}
                  onPress={() =>
                    setAnswers((current) => ({
                      ...current,
                      [question.id]: option.label,
                    }))
                  }
                  selected={answers[question.id] === option.label}
                  tone="secondary"
                />
              ))}
            </View>
          ) : (
            <TextInput
              accessibilityLabel={`Answer ${question.header || question.question}`}
              onChangeText={(answer) =>
                setAnswers((current) => ({ ...current, [question.id]: answer }))
              }
              secureTextEntry={question.isSecret}
              style={[
                styles.answerInput,
                { borderColor: colors.borderStrong, color: colors.textPrimary },
              ]}
              value={answers[question.id] ?? ""}
            />
          )}
        </View>
      ))}
      <RequestButton
        disabled={!complete || busy}
        label="Submit answers"
        onPress={() => {
          setBusy(true);
          void onSubmit(request.requestId, answers).finally(() =>
            setBusy(false),
          );
        }}
        tone="primary"
      />
    </View>
  );
}

function RequestButton({
  disabled = false,
  label,
  onPress,
  selected = false,
  tone,
}: {
  disabled?: boolean;
  label: string;
  onPress(): void;
  selected?: boolean;
  tone: "primary" | "secondary";
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.requestButton,
        {
          backgroundColor:
            tone === "primary" || selected
              ? colors.textPrimary
              : colors.bgPanel,
          borderColor: selected ? colors.accent : colors.borderStrong,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text
        style={{
          color:
            tone === "primary" || selected ? colors.bgBase : colors.textPrimary,
          fontWeight: "700",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function sessionHeaderState(timeline: SessionTimelineState): ConnectionState {
  if (timeline.connectionState === "reconnecting") return "connecting";
  if (timeline.connectionState !== "live") return timeline.connectionState;
  const status = timeline.turnStatus?.status;
  if (status === "running" || status === "queued") return "live";
  if (["failed", "error", "cancelled", "canceled"].includes(status ?? ""))
    return "failed";
  return "complete";
}

function markdownStyles(colors: ReturnType<typeof useAppTheme>["colors"]) {
  return {
    body: {
      color: colors.textPrimary,
      fontSize: 15.5,
      lineHeight: 23,
      margin: 0,
    },
    code_inline: {
      backgroundColor: colors.bgRaised,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    code_block: {
      backgroundColor: colors.bgRaised,
      borderColor: colors.borderStrong,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    fence: {
      backgroundColor: colors.bgRaised,
      borderColor: colors.borderStrong,
      color: colors.textPrimary,
      fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    },
    link: { color: colors.accent },
  };
}

function activityMarkdownStyles(
  colors: ReturnType<typeof useAppTheme>["colors"],
) {
  const base = markdownStyles(colors);
  return {
    ...base,
    body: {
      ...base.body,
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
    },
  };
}

const styles = StyleSheet.create({
  actionSheet: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    maxHeight: "90%",
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  actionSheetBackdrop: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
    flex: 1,
    justifyContent: "flex-end",
  },
  actionSheetKeyboard: {
    flex: 1,
  },
  actionIcon: {
    alignItems: "center",
    borderRadius: radii.md,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  actionSheetCopy: { flex: 1, gap: spacing.xxs },
  actionSheetContent: {
    gap: spacing.xs,
  },
  actionSheetHandle: {
    alignSelf: "center",
    borderRadius: radii.pill,
    height: 4,
    width: 38,
  },
  actionSheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    marginBottom: spacing.xs,
  },
  actionSheetHeaderButton: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 48,
  },
  actionSheetHeading: { alignItems: "center", flex: 1, gap: 2 },
  actionSheetRow: {
    alignItems: "center",
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    padding: spacing.sm,
  },
  actionSheetSubtitle: { fontSize: 12 },
  actionSheetTitle: { fontSize: 18, fontWeight: "800" },
  actionSearch: {
    borderRadius: radii.md,
    borderWidth: 1,
    fontSize: 16,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  contextGroup: { gap: spacing.xs },
  contextGroupTitle: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.7,
    paddingHorizontal: spacing.xs,
    textTransform: "uppercase",
  },
  contextRow: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 58,
    padding: spacing.sm,
  },
  contextType: {
    alignItems: "center",
    borderRadius: radii.sm,
    justifyContent: "center",
    minHeight: 34,
    minWidth: 48,
    paddingHorizontal: spacing.xs,
  },
  contextChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  contextChip: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: "90%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  magicCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  magicCategory: {
    borderRadius: radii.pill,
    fontSize: 11,
    fontWeight: "800",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
  },
  magicHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  magicCopy: {
    gap: spacing.xxs,
  },
  magicDescription: {
    fontSize: 13,
    lineHeight: 18,
  },
  magicRun: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  magicTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  safeArea: { flex: 1 },
  thread: { flex: 1 },
  header: {
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    paddingHorizontal: spacing.xs,
    paddingVertical: spacing.xs,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  taskLink: {
    alignItems: "center",
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.xs,
    height: 42,
    justifyContent: "center",
    maxWidth: 112,
    paddingHorizontal: spacing.sm,
  },
  taskLinkText: { fontSize: 13, fontWeight: "800" },
  changeCount: {
    fontSize: 11,
    fontWeight: "700",
    position: "absolute",
    right: 6,
    top: 5,
  },
  titleBlock: { alignItems: "center", flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: "700", maxWidth: "100%" },
  titleMeta: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  sessionId: { fontSize: 11 },
  turnControl: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    minWidth: 54,
  },
  messageListContent: {
    flexGrow: 1,
    // Activity rows are intentionally dense: a long orchestrator transcript must
    // behave like the compact Codex activity stream, not distribute system events
    // through the empty viewport.
    gap: spacing.xs,
    justifyContent: "flex-start",
    padding: spacing.md,
  },
  message: {
    maxWidth: "100%",
  },
  userMessage: {
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: "92%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  assistantMessage: {
    paddingHorizontal: spacing.xxs,
    paddingVertical: spacing.xs,
    width: "100%",
  },
  activityMessage: { paddingVertical: spacing.xxs, width: "100%" },
  messageText: { fontSize: 16, lineHeight: 23 },
  activityDisclosure: { width: "100%" },
  activityHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.xs,
  },
  activityTitle: { flex: 1, fontSize: 13, fontWeight: "600" },
  activityMeta: { fontSize: 11 },
  activityBody: {
    borderLeftWidth: 2,
    marginLeft: spacing.sm,
    paddingBottom: spacing.xs,
    paddingLeft: spacing.md,
    paddingTop: spacing.xs,
  },
  toolCard: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 38,
    paddingHorizontal: spacing.sm,
  },
  toolName: { flex: 1, fontSize: 13, fontWeight: "700" },
  toolStatus: { fontSize: 11 },
  toolGroup: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolGroupHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  toolGroupTitle: { flex: 1, fontSize: 13, fontWeight: "700" },
  toolGroupDetails: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toolDetail: { paddingVertical: spacing.xxs },
  toolDetailHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 30,
  },
  toolDetailName: { flex: 1, fontSize: 12, fontWeight: "600" },
  toolOutput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 12,
    lineHeight: 17,
    maxHeight: 220,
    padding: spacing.sm,
  },
  taskCreationCard: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 62,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  taskCreationCopy: { flex: 1, minWidth: 0 },
  taskCreationLabel: { fontSize: 13, fontWeight: "700" },
  taskCreationDescription: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  taskCreationIdentifier: { fontSize: 12, fontWeight: "800" },
  killTool: {
    alignItems: "flex-end",
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  killToolText: { fontSize: 12, fontWeight: "700" },
  composerShell: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    position: "relative",
  },
  dictationError: {
    fontSize: 12,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  composer: {
    alignItems: "stretch",
  },
  composerSurface: {
    borderRadius: 30,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xxs,
  },
  permissionButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  addContextButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  modelChip: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minWidth: 0,
    paddingHorizontal: spacing.xs,
  },
  modelLabel: { flexShrink: 0, fontSize: 16, fontWeight: "700" },
  composerActions: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: spacing.xxs,
    paddingTop: spacing.xxs,
  },
  composerSendActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
    marginLeft: spacing.xs,
  },
  micButton: {
    alignItems: "center",
    height: 48,
    justifyContent: "center",
    width: 44,
  },
  stopDictationLabel: { fontSize: 11, fontWeight: "800" },
  settingsOverlay: {
    bottom: "100%",
    left: 0,
    marginBottom: spacing.sm,
    position: "absolute",
    right: 0,
    zIndex: 20,
  },
  settingsPanel: {
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    shadowColor: "#000",
    shadowOffset: { height: 12, width: 0 },
    shadowOpacity: 0.28,
    shadowRadius: 24,
    elevation: 10,
    padding: spacing.sm,
    width: "100%",
  },
  settingsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    minHeight: 28,
  },
  settingsHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    minWidth: 0,
  },
  settingsTitle: { fontSize: 13, fontWeight: "700" },
  settingsOption: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 47,
  },
  settingsCopy: { flex: 1, minWidth: 0 },
  settingsDescription: { fontSize: 11, lineHeight: 15 },
  input: {
    flexGrow: 0,
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    maxHeight: 112,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  composerButton: {
    alignItems: "center",
    borderRadius: radii.pill,
    height: 48,
    justifyContent: "center",
    width: 48,
  },
  error: { flex: 1, fontSize: 13 },
  errorRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  retry: { fontSize: 13, fontWeight: "700" },
  requestCard: {
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  queuedDock: {
    alignItems: "center",
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  queuedCopy: { flex: 1, minWidth: 0 },
  queuedLabel: { fontSize: 11, fontWeight: "800" },
  queuedText: { fontSize: 12, marginTop: 1 },
  queuedProvider: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  queuedCount: { fontSize: 11, fontWeight: "700" },
  goalDock: {
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  goalCopy: { flex: 1, minWidth: 0 },
  goalTitle: { fontSize: 12, fontWeight: "700" },
  goalSummary: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: 1,
  },
  goalObjective: { fontSize: 11, marginTop: 1 },
  goalDuration: { fontSize: 11, fontVariant: ["tabular-nums"] },
  goalButtons: { flexDirection: "row", gap: spacing.xxs },
  goalButton: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 28,
  },
  goalEditor: { gap: spacing.xs, paddingTop: spacing.xs, width: "100%" },
  goalInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    fontSize: 13,
    minHeight: 62,
    padding: spacing.sm,
  },
  requestTitle: { fontSize: 14, fontWeight: "700" },
  requestActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  requestButton: {
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  command: {
    fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }),
    fontSize: 13,
  },
  question: { gap: spacing.xs },
  answerInput: {
    borderRadius: radii.sm,
    borderWidth: 1,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
});
