import {
  AudioLines,
  CircleDot,
  FileText,
  FolderOpen,
  GitPullRequest,
  MessageSquare,
  Mic,
  Plus,
  Send,
  Shield,
  ShieldAlert,
  Square,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  hydrateAttachments,
  revokeAttachmentPreviews,
  serializeAttachments,
  type AssistantOutgoingAttachment,
} from "@/components/assistant/assistantAttachments";
import { ASSISTANT_CHAT_MESSAGE_TEXT_CLASS } from "@/components/assistant/chatTypography";
import { ComposerMoreMenu, ComposerToolbar } from "@/components/assistant/ComposerToolbar";
import { useIsLgUp } from "@/hooks/useMediaQuery";
import {
  ContextMentionPopover,
  orderMentionOptions,
} from "@/components/assistant/ContextMentionPopover";
import type { ComposerContextChipRef, MentionRef, ResolvedMention } from "@/components/assistant/contextMentions";
import { useComposerAttachments } from "@/components/assistant/useComposerAttachments";
import { useContextMentions } from "@/components/assistant/useContextMentions";
import { MagicCommandPalette } from "@/components/commands/MagicCommandPalette";
import type { RunPromptTemplateResult } from "@/services/magicCommands";
import {
  allSlashCommands,
  defaultSkillCommands,
  matchingSlashCommands,
  parseSlashCommand,
  type SlashCommandContext,
  type SlashCommandDef,
} from "@/components/assistant/slashCommands";
import { isVideoMediaType } from "@/services/attachments";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  catalogFor,
  defaultComposerSettings,
  loadComposerState,
  normalizeEffort,
  saveComposerState,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantComposerState,
  type AssistantEffort,
} from "@/lib/assistantSettings";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

function addContextRef(current: ComposerContextChipRef[], ref: ComposerContextChipRef): ComposerContextChipRef[] {
  if (!ref.id.trim()) return current;
  if (current.some((currentRef) => currentRef.type === ref.type && currentRef.id === ref.id)) return current;
  return [...current, { ...ref, state: ref.state ?? "draft" }];
}

function contextIconFor(type: ComposerContextChipRef["type"]) {
  if (type === "issue") return CircleDot;
  if (type === "pr") return GitPullRequest;
  if (type === "saved") return FolderOpen;
  if (type === "session") return MessageSquare;
  if (type === "security" || type === "security_alert") return Shield;
  if (type === "advisory") return ShieldAlert;
  return FileText;
}

/** Minimum textarea height (~2.75rem) before content grows the composer. */
export const COMPOSER_TEXTAREA_MIN_HEIGHT_PX = 44;
/** Cap so the composer grows with typing but never eats the chat viewport. */
export const COMPOSER_TEXTAREA_MAX_HEIGHT_PX = 240;

function syncComposerTextareaHeight(textarea: HTMLTextAreaElement): void {
  textarea.style.height = "0px";
  const contentHeight = textarea.scrollHeight;
  const nextHeight = Math.min(
    Math.max(contentHeight, COMPOSER_TEXTAREA_MIN_HEIGHT_PX),
    COMPOSER_TEXTAREA_MAX_HEIGHT_PX,
  );
  textarea.style.height = `${nextHeight}px`;
  textarea.scrollTop = textarea.scrollHeight;
}

export type AssistantComposerSubmitKind = "message" | "infer" | "btw" | "goal" | "new_thread";

export interface AssistantComposerSubmit {
  kind: AssistantComposerSubmitKind;
  message: string;
  agent: AgentKind;
  settings: AssistantComposerSettings;
  attachments: ReturnType<typeof serializeAttachments>;
  contextRefs: ComposerContextChipRef[];
}

export interface ComposerSnapshot {
  input: string;
  attachments: ReturnType<typeof serializeAttachments>;
}

export interface ComposerDraftSeed {
  requestId: number;
  message: string;
  attachments: AssistantOutgoingAttachment[];
  contextRefs: ComposerContextChipRef[];
}

export interface ComposerContextInsertRequest {
  id: number;
  ref: ComposerContextChipRef;
}

/**
 * `@`-mention wiring. When enabled, the parent supplies `mentionOptions` for
 * the current query (reported via `onMentionQueryChange`) and records
 * selections via `onMentionSelect` so it can expand the inserted tokens into
 * the dispatched prompt.
 */
export interface ComposerMentionProps {
  /** Enables `@`-mentions (issues / files / PRs) in the textarea. */
  mentionsEnabled?: boolean;
  mentionOptions?: ResolvedMention[];
  onMentionQueryChange?: (query: string | null) => void;
  onMentionSelect?: (entity: ResolvedMention) => void;
}

/** Magic command palette wiring (open triggers and run results). */
export interface ComposerMagicProps {
  /** Incrementing token from the parent's Magic button that opens the palette. */
  magicPaletteRequestId?: number;
  /** Controlled open state for the magic palette (e.g. execution toolbar toggle). */
  magicPaletteOpen?: boolean;
  onMagicPaletteOpenChange?: (open: boolean) => void;
  /** Issue identifier for prompt-template magic commands (execution context). */
  magicIssueIdentifier?: string;
  onMagicRan?: (result: RunPromptTemplateResult) => void;
}

/** Slash-command palette configuration. */
export interface ComposerSlashCommandProps {
  slashContext?: SlashCommandContext;
  slashCommandExtras?: SlashCommandDef[];
}

/** Agent / model / effort selection reporting and seeding. */
export interface ComposerAgentSelectionProps {
  /** Reports the currently selected agent (on mount and on every change). */
  onAgentChange?: (agent: AgentKind) => void;
  /** Reports the selected agent's model/effort settings (on mount and change). */
  onSettingsChange?: (agent: AgentKind, settings: AssistantComposerSettings) => void;
  /** Initial/server-resolved agent for reopening a persisted session. */
  agentSeed?: AgentKind | null;
  /** When set, seeds agent/model/effort from task settings instead of sessionStorage. */
  settingsSeed?: { agent: AgentKind; model: string; effort: string } | null;
  /** When false, skip writing composer agent/model/effort to sessionStorage (task SoT). */
  persistLocalComposerState?: boolean;
}

/** Slots for parent-provided elements rendered inside the composer chrome. */
export interface ComposerSlotProps {
  /**
   * Optional element rendered flush inside the composer card, above the input
   * (e.g. the authoring-goal pill). Sharing the card makes it read as one piece
   * with the message box instead of a detached banner.
   */
  header?: ReactNode;
  toolbarAfterAttach?: ReactNode;
  /**
   * Secondary tools collapsed into a More menu below `lg` (Diff, KB, Yolo, Magic, etc.).
   * At `lg+` these render inline after `toolbarAfterAttach`.
   */
  toolbarMore?: ReactNode;
  submitActions?: ReactNode;
  footer?: ReactNode;
}

interface AssistantComposerProps
  extends ComposerMentionProps,
    ComposerMagicProps,
    ComposerSlashCommandProps,
    ComposerAgentSelectionProps,
    ComposerSlotProps {
  projectSlug: string;
  bundle: AssistantCatalogBundle;
  disabled?: boolean;
  floating?: boolean;
  hasQueued?: boolean;
  seedMessage?: string | null;
  /** Bumped `requestId` replaces the current composer draft (text/attachments/refs). */
  draftSeed?: ComposerDraftSeed | null;
  placeholder?: string;
  /** When `null`, the footer hint is hidden. */
  hint?: string | null;
  resetToken?: number;
  composerDisabled?: boolean;
  agentMenuDisabled?: boolean;
  canSubmit?: boolean;
  /** Allow submit (and the default send affordance) with an empty input. */
  allowEmptySubmit?: boolean;
  contextInsertRequest?: ComposerContextInsertRequest | null;
  onForceQueued?: () => void;
  /** Called when Enter is pressed with an empty input (no attachments). */
  onEmptySubmit?: () => void;
  onSubmit: (payload: AssistantComposerSubmit) => void;
  onComposerSnapshot?: (snapshot: ComposerSnapshot) => void;
  /**
   * Optional element that acts as the file drop zone. When provided, dropping
   * files anywhere inside it (e.g. the whole assistant panel) attaches them,
   * instead of only the composer form.
   */
  dropTargetRef?: React.RefObject<HTMLElement | null>;
}

export function AssistantComposer({
  projectSlug,
  bundle,
  disabled = false,
  floating = false,
  hasQueued = false,
  seedMessage = null,
  draftSeed = null,
  slashContext = "authoring",
  slashCommandExtras,
  magicPaletteRequestId = 0,
  magicPaletteOpen,
  onMagicPaletteOpenChange,
  magicIssueIdentifier,
  onMagicRan,
  placeholder,
  hint,
  resetToken,
  composerDisabled = false,
  agentMenuDisabled = false,
  canSubmit,
  allowEmptySubmit = false,
  mentionsEnabled = false,
  mentionOptions,
  onMentionQueryChange,
  onMentionSelect,
  header,
  toolbarAfterAttach,
  toolbarMore,
  submitActions,
  footer,
  contextInsertRequest = null,
  onForceQueued,
  onEmptySubmit,
  onSubmit,
  onComposerSnapshot,
  onAgentChange,
  onSettingsChange,
  agentSeed = null,
  settingsSeed = null,
  persistLocalComposerState = true,
  dropTargetRef,
}: AssistantComposerProps) {
  const { t } = useTranslation();
  const isLgUp = useIsLgUp();
  const [input, setInput] = useState("");
  const [internalMagicOpen, setInternalMagicOpen] = useState(false);
  const magicOpen = magicPaletteOpen ?? internalMagicOpen;
  const setMagicOpen = onMagicPaletteOpenChange ?? setInternalMagicOpen;
  const {
    attachments,
    uploadingImage,
    dragActive,
    nativeDropZoneActive,
    handleFilePick,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    removeAttachment,
    clearAttachments,
    replaceAttachments,
  } = useComposerAttachments({ projectSlug, dropTargetRef });
  const [contextRefs, setContextRefs] = useState<ComposerContextChipRef[]>([]);
  const lastDraftSeedIdRef = useRef(0);
  const [composerState, setComposerState] = useState<AssistantComposerState>(() => {
    if (settingsSeed) {
      return {
        agent: settingsSeed.agent,
        byAgent: {
          [settingsSeed.agent]: { model: settingsSeed.model, effort: settingsSeed.effort },
        },
      };
    }
    // Task-scoped composers must not hydrate from browser storage — the issue
    // (or catalog defaults after fetch) is the source of truth.
    if (!persistLocalComposerState) {
      return { agent: bundle.defaultAgent, byAgent: {} };
    }
    return loadComposerState(bundle);
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recordingRef = useRef(false);
  const speech = useSpeechRecognition();
  const {
    error: speechError,
    listening: speechListening,
    start: startSpeechRecognition,
    stop: stopSpeechRecognition,
    supported: speechSupported,
  } = speech;
  const recording = speechListening;

  // Derive per-agent catalog and settings
  const catalog = catalogFor(bundle, composerState.agent);
  const settings: AssistantComposerSettings =
    composerState.byAgent[composerState.agent] ?? defaultComposerSettings(catalog);

  useEffect(() => {
    // Seed only via initial state (or remount). Avoid resetting mid-interaction when
    // the parent recomputes settingsSeed after catalog load.
    if (!agentSeed || settingsSeed) return;
    setComposerState((current) => {
      if (current.agent === agentSeed) return current;
      const nextCatalog = catalogFor(bundle, agentSeed);
      const nextSettings = current.byAgent[agentSeed] ?? defaultComposerSettings(nextCatalog);
      return {
        ...current,
        agent: agentSeed,
        byAgent: {
          ...current.byAgent,
          [agentSeed]: nextSettings,
        },
      };
    });
  }, [agentSeed, bundle, settingsSeed]);

  // Persist on every state change
  useEffect(() => {
    if (!persistLocalComposerState) return;
    saveComposerState(composerState);
  }, [composerState, persistLocalComposerState]);

  // Surface the selected agent so consumers (e.g. the dispatch panel) can mirror it.
  useEffect(() => {
    onAgentChange?.(composerState.agent);
  }, [composerState.agent, onAgentChange]);

  // Surface model/effort so the dispatch panel can forward them to the orchestrator.
  // Depend on the primitive fields (not the derived `settings` object) to avoid
  // firing on every render via a fresh object identity.
  const settingsModel = settings.model;
  const settingsEffort = settings.effort;
  useEffect(() => {
    onSettingsChange?.(composerState.agent, { model: settingsModel, effort: settingsEffort });
  }, [composerState.agent, settingsModel, settingsEffort, onSettingsChange]);

  // When bundle changes, re-validate current model against the catalog for active agent
  useEffect(() => {
    setComposerState((current) => {
      const activeCatalog = catalogFor(bundle, current.agent);
      const currentSettings = current.byAgent[current.agent] ?? defaultComposerSettings(activeCatalog);
      const modelOption =
        activeCatalog.models.find((m) => m.model === currentSettings.model) ?? activeCatalog.models[0];
      return {
        ...current,
        byAgent: {
          ...current.byAgent,
          [current.agent]: {
            model: modelOption.model,
            effort: normalizeEffort(modelOption, currentSettings.effort),
          },
        },
      };
    });
  }, [bundle]);

  useEffect(() => {
    if (!seedMessage?.trim()) return;
    setInput(seedMessage);
  }, [seedMessage]);

  useEffect(() => {
    if (!draftSeed || draftSeed.requestId === lastDraftSeedIdRef.current) return;
    if (!Number.isFinite(draftSeed.requestId) || draftSeed.requestId <= 0) return;

    lastDraftSeedIdRef.current = draftSeed.requestId;
    setInput(draftSeed.message ?? "");
    replaceAttachments(hydrateAttachments(draftSeed.attachments ?? []));
    setContextRefs(Array.isArray(draftSeed.contextRefs) ? draftSeed.contextRefs : []);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draftSeed, replaceAttachments]);

  useEffect(() => {
    return () => {
      stopSpeechRecognition();
    };
  }, [stopSpeechRecognition]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    syncComposerTextareaHeight(textarea);
  }, [input]);

  useEffect(() => {
    if (resetToken === undefined) return;
    setInput("");
    clearAttachments();
    setContextRefs([]);
    mentions.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetToken]);

  useEffect(() => {
    onComposerSnapshot?.({
      input,
      attachments: serializeAttachments(attachments),
    });
  }, [attachments, input, onComposerSnapshot]);

  const parsedInput = parseSlashCommand(input, t, slashContext);
  const hasComposerContent =
    parsedInput.kind === "goal" || input.trim().length > 0 || attachments.length > 0 || contextRefs.length > 0;
  const canSend =
    !recording &&
    !uploadingImage &&
    (hasComposerContent || allowEmptySubmit) &&
    (canSubmit ?? true) &&
    !composerDisabled &&
    !disabled;

  const paletteCommands = matchingSlashCommands(
    input,
    t,
    slashContext,
    slashCommandExtras ?? defaultSkillCommands(t, slashContext),
  );
  const showPalette = paletteCommands.length > 0 && input.trim().split(" ").length === 1;

  const mentions = useContextMentions(input);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [paletteActiveIndex, setPaletteActiveIndex] = useState(0);
  const paletteListRef = useRef<HTMLDivElement>(null);
  const orderedMentions = mentionsEnabled ? orderMentionOptions(mentionOptions ?? []) : [];
  const showMentions = mentionsEnabled && mentions.open && orderedMentions.length > 0;

  useEffect(() => {
    if (magicPaletteRequestId <= 0) return;
    setMagicOpen(true);
  }, [magicPaletteRequestId]);

  const magicCommands = allSlashCommands(
    t,
    slashContext,
    slashCommandExtras ?? defaultSkillCommands(t, slashContext),
  );

  useEffect(() => {
    if (!contextInsertRequest) return;
    setContextRefs((current) => addContextRef(current, contextInsertRequest.ref));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [contextInsertRequest]);

  // Report the active query (or null when closed) so the parent can fetch options.
  useEffect(() => {
    if (!mentionsEnabled) return;
    onMentionQueryChange?.(mentions.open ? mentions.query : null);
  }, [mentionsEnabled, mentions.open, mentions.query, onMentionQueryChange]);

  // Reset the highlighted row whenever the candidate set changes.
  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentions.query, orderedMentions.length]);

  useEffect(() => {
    setPaletteActiveIndex(0);
  }, [input, paletteCommands.length]);

  useEffect(() => {
    if (!showPalette || !paletteListRef.current) return;
    const active = paletteListRef.current.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "nearest" });
  }, [paletteActiveIndex, showPalette]);

  function applySlashCommand(command: SlashCommandDef) {
    setInput(command.insertText ?? `${command.name} `);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function selectActiveMention(ref: MentionRef) {
    const resolved = (mentionOptions ?? []).find(
      (option) => option.type === ref.type && option.id === ref.id,
    );
    if (resolved) {
      const next = mentions.removeMentionText();
      if (next !== null) setInput(next);
      setContextRefs((current) => addContextRef(current, { ...resolved, state: "draft" }));
      onMentionSelect?.(resolved);
    } else {
      const next = mentions.selectMention(ref);
      if (next !== null) setInput(next);
    }
    setMentionActiveIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function updateAgent(agent: AgentKind) {
    setComposerState((current) => {
      const nextCatalog = catalogFor(bundle, agent);
      // If no saved settings for this agent, seed with defaults
      const nextSettings = current.byAgent[agent] ?? defaultComposerSettings(nextCatalog);
      return {
        ...current,
        agent,
        byAgent: {
          ...current.byAgent,
          [agent]: nextSettings,
        },
      };
    });
  }

  function updateModel(model: string) {
    setComposerState((current) => {
      const activeCatalog = catalogFor(bundle, current.agent);
      const modelOption = activeCatalog.models.find((entry) => entry.model === model) ?? activeCatalog.models[0];
      const currentSettings = current.byAgent[current.agent] ?? defaultComposerSettings(activeCatalog);
      return {
        ...current,
        byAgent: {
          ...current.byAgent,
          [current.agent]: {
            model: modelOption.model,
            effort: normalizeEffort(modelOption, currentSettings.effort),
          },
        },
      };
    });
  }

  function updateEffort(effort: AssistantEffort) {
    setComposerState((current) => {
      const activeCatalog = catalogFor(bundle, current.agent);
      const currentSettings = current.byAgent[current.agent] ?? defaultComposerSettings(activeCatalog);
      const modelOption =
        activeCatalog.models.find((m) => m.model === currentSettings.model) ?? activeCatalog.models[0];
      return {
        ...current,
        byAgent: {
          ...current.byAgent,
          [current.agent]: {
            ...currentSettings,
            effort: normalizeEffort(modelOption, effort),
          },
        },
      };
    });
  }

  function removeContextRef(type: ComposerContextChipRef["type"], id: string) {
    setContextRefs((current) => current.filter((ref) => ref.type !== type || ref.id !== id));
  }

  function submitCurrent() {
    if (!canSend) return;

    const parsed = parseSlashCommand(input, t, slashContext);
    // `/goal` may be issued with no objective (the assistant derives it from the
    // issue artifacts); every other command requires an argument.
    if (parsed.kind !== "message" && parsed.kind !== "goal" && parsed.argument.length === 0) return;

    onSubmit({
      kind: parsed.kind,
      message: parsed.kind === "message" ? input : parsed.argument,
      agent: composerState.agent,
      settings,
      attachments: serializeAttachments(attachments),
      contextRefs,
    });

    revokeAttachmentPreviews(attachments);
    setInput("");
    clearAttachments();
    setContextRefs([]);
    mentions.close();
    recordingRef.current = false;
    stopSpeechRecognition();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitCurrent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (showMentions) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % orderedMentions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionActiveIndex((index) => (index - 1 + orderedMentions.length) % orderedMentions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const option = orderedMentions[mentionActiveIndex];
        if (option) selectActiveMention({ type: option.type, id: option.id });
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        mentions.close();
        return;
      }
    }

    if (showPalette && paletteCommands.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setPaletteActiveIndex((index) => (index + 1) % paletteCommands.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setPaletteActiveIndex((index) => (index - 1 + paletteCommands.length) % paletteCommands.length);
        return;
      }
      if (event.key === "Tab" && !event.shiftKey) {
        event.preventDefault();
        const command = paletteCommands[paletteActiveIndex] ?? paletteCommands[0];
        if (command) applySlashCommand(command);
        return;
      }
    }

    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    if (input.trim().length === 0) {
      if (attachments.length > 0 || contextRefs.length > 0) {
        submitCurrent();
        return;
      }
      if (hasQueued) {
        onForceQueued?.();
        return;
      }
      onEmptySubmit?.();
      return;
    }

    submitCurrent();
  }

  async function toggleRecording() {
    if (disabled) return;

    if (recording) {
      recordingRef.current = false;
      stopSpeechRecognition();
      return;
    }

    if (!speechSupported) {
      toast.error(t("assistant.composer.voiceNotSupported"));
      return;
    }

    recordingRef.current = true;

    startSpeechRecognition((text, isFinal) => {
      if (!isFinal) return;
      setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
    });
  }

  const dropOverlay = dragActive ? (
    <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center border-2 border-dashed border-primary/60 bg-background/85 text-sm font-medium text-primary">
      {t("assistant.composer.dropFiles")}
    </div>
  ) : null;

  return (
    <form
      className={cn("relative bg-background", floating ? "px-0 pb-0 pt-0" : "border-t p-4")}
      onSubmit={handleSubmit}
      onDragEnter={nativeDropZoneActive ? undefined : handleDragEnter}
      onDragOver={nativeDropZoneActive ? undefined : handleDragOver}
      onDragLeave={nativeDropZoneActive ? undefined : handleDragLeave}
      onDrop={nativeDropZoneActive ? undefined : handleDrop}
    >
      {nativeDropZoneActive
        ? dragActive && dropTargetRef?.current
          ? createPortal(dropOverlay, dropTargetRef.current)
          : null
        : dropOverlay}
      <MagicCommandPalette
        open={magicOpen}
        onOpenChange={setMagicOpen}
        slashCommands={magicCommands}
        onSlashSelect={applySlashCommand}
        projectSlug={magicIssueIdentifier ? projectSlug : undefined}
        identifier={magicIssueIdentifier}
        onRan={onMagicRan}
      />
      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-card transition-shadow",
          floating ? "shadow-lg" : "shadow-sm",
          recording && "ring-2 ring-primary/30",
        )}
      >
        {header ?? null}

        {contextRefs.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b px-3 py-2">
            {contextRefs.map((ref) => {
              const Icon = contextIconFor(ref.type);
              return (
                <div
                  key={`${ref.type}:${ref.id}`}
                  className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[8rem] truncate font-medium">{ref.id}</span>
                  {ref.label ? <span className="max-w-[12rem] truncate text-muted-foreground">{ref.label}</span> : null}
                  <button
                    type="button"
                    aria-label={`Remove context ${ref.id}`}
                    onClick={() => removeContextRef(ref.type, ref.id)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b px-3 py-2">
            {attachments.map((attachment) => {
              if (attachment.type === "image" && attachment.previewUrl) {
                return (
                  <div key={attachment.id} className="group relative">
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name}
                      className="h-16 w-16 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t("assistant.composer.removeAttachment", { name: attachment.name })}
                      onClick={() => removeAttachment(attachment.id)}
                      className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              }

              if (attachment.type === "file" && attachment.previewUrl && isVideoMediaType(attachment.mediaType)) {
                return (
                  <div key={attachment.id} className="group relative">
                    <video
                      src={attachment.previewUrl}
                      controls
                      playsInline
                      preload="metadata"
                      aria-label={attachment.name}
                      className="h-24 w-40 rounded-lg border bg-black/5 object-contain"
                    />
                    <button
                      type="button"
                      aria-label={t("assistant.composer.removeAttachment", { name: attachment.name })}
                      onClick={() => removeAttachment(attachment.id)}
                      className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              }

              const Icon = attachment.type === "audio" ? AudioLines : FileText;
              return (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="max-w-[12rem] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={t("assistant.composer.removeAttachment", { name: attachment.name })}
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {showPalette ? (
          <div className="border-b px-2 py-1.5">
            <div
              ref={paletteListRef}
              role="listbox"
              aria-label={t("assistant.composer.slashCommands")}
              className={cn("max-h-52 overflow-y-auto", SCROLLBAR_THIN)}
            >
              {paletteCommands.map((command, index) => {
                const isActive = index === paletteActiveIndex;
                return (
                  <button
                    key={command.name}
                    type="button"
                    role="option"
                    data-active={isActive ? "true" : "false"}
                    aria-selected={isActive}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                      isActive ? "bg-muted/60" : "hover:bg-muted/60",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      applySlashCommand(command);
                    }}
                    onMouseEnter={() => setPaletteActiveIndex(index)}
                  >
                    <span className="shrink-0 font-mono text-xs font-semibold">{command.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{command.description}</span>
                  </button>
                );
              })}
            </div>
            <p className="px-2 pt-1 text-[10px] text-muted-foreground">{t("assistant.composer.tabToComplete")}</p>
          </div>
        ) : null}

        {showMentions ? (
          <div className="border-b px-1 py-1">
            <ContextMentionPopover
              open
              options={mentionOptions ?? []}
              activeIndex={mentionActiveIndex}
              onSelect={selectActiveMention}
            />
          </div>
        ) : null}

        <Textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            const value = event.target.value;
            setInput(value);
            if (mentionsEnabled) {
              mentions.handleChange(value, event.target.selectionStart ?? value.length);
            }
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder ?? t("assistant.composer.placeholder")}
          className={cn(
            ASSISTANT_CHAT_MESSAGE_TEXT_CLASS,
            SCROLLBAR_THIN,
            "min-h-[2.75rem] max-h-[240px] resize-none overflow-y-auto border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0",
          )}
        />

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => void handleFilePick(event)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={disabled || composerDisabled || uploadingImage}
              aria-label={t("assistant.composer.attachFile")}
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </Button>
            {toolbarAfterAttach}
            {toolbarMore ? (
              <ComposerMoreMenu disabled={disabled || composerDisabled}>{toolbarMore}</ComposerMoreMenu>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1">
            <ComposerToolbar
              bundle={bundle}
              catalog={catalog}
              agent={composerState.agent}
              settings={settings}
              disabled={disabled}
              composerDisabled={composerDisabled}
              agentMenuDisabled={agentMenuDisabled}
              compact={!isLgUp}
              onAgentChange={updateAgent}
              onModelChange={updateModel}
              onEffortChange={updateEffort}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "relative h-8 w-8 overflow-visible rounded-full",
                recording &&
                  "bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50",
              )}
              disabled={disabled || composerDisabled}
              aria-label={recording ? t("assistant.composer.stopRecording") : t("assistant.composer.recordAudio")}
              onClick={() => void toggleRecording()}
            >
              {recording ? (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-full bg-red-500/20 motion-safe:animate-ping"
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.18)] motion-safe:animate-pulse"
                  />
                  <Square className="relative h-3.5 w-3.5 fill-current" />
                </>
              ) : (
                <Mic className={cn("h-4 w-4", speechListening && "animate-pulse")} />
              )}
            </Button>
            {recording ? (
              <span className="inline-flex items-center gap-1 px-1 text-xs text-muted-foreground" aria-live="polite">
                <AudioLines className="h-3.5 w-3.5 animate-pulse text-primary" />
                {t("assistant.composer.recording")}
              </span>
            ) : null}
            {submitActions ?? (
              <Button
                type="submit"
                variant="default"
                size="icon"
                className="h-8 w-8 rounded-full"
                disabled={!canSend}
                aria-label={t("assistant.composer.sendMessage")}
                title={t("assistant.composer.sendMessage")}
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      {hint === null ? null : (
        <p className={cn("text-xs text-muted-foreground", floating ? "mt-1.5" : "mt-2")}>
          {hint ?? t("assistant.composer.hint", { command: catalog.command })}
          {speechError ? (
            <span className="text-destructive">{t("assistant.composer.voiceUnavailable", { error: speechError })}</span>
          ) : null}
        </p>
      )}
      {footer}
    </form>
  );
}
