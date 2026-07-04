import {
  AudioLines,
  Bot,
  Brain,
  ChevronDown,
  CircleDot,
  Feather,
  FileText,
  Flame,
  FolderOpen,
  GitPullRequest,
  MessageSquare,
  Mic,
  Plus,
  Send,
  Shield,
  ShieldAlert,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  type DragEvent,
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
  type AssistantAttachment,
  createAttachmentPreview,
  revokeAttachmentPreviews,
  serializeAttachments,
  validateAttachmentFile,
} from "@/components/assistant/assistantAttachments";
import {
  ContextMentionPopover,
  orderMentionOptions,
} from "@/components/assistant/ContextMentionPopover";
import type { ComposerContextChipRef, MentionRef, ResolvedMention } from "@/components/assistant/contextMentions";
import { useContextMentions } from "@/components/assistant/useContextMentions";
import { ModelMenu } from "@/components/assistant/ModelMenu";
import { ComposerCommandPalette } from "@/components/assistant/ComposerCommandPalette";
import {
  allSlashCommands,
  defaultSkillCommands,
  matchingSlashCommands,
  parseSlashCommand,
  type SlashCommandContext,
  type SlashCommandDef,
} from "@/components/assistant/slashCommands";
import { agentKindLabel } from "@/components/shared/AgentChip";
import { uploadAssistantAttachment } from "@/services/assistant";
import { isVideoMediaType } from "@/services/attachments";
import { extractFilesFromClipboard } from "@/lib/clipboardImages";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  catalogFor,
  defaultComposerSettings,
  effortLabel,
  effortsForModel,
  loadComposerState,
  normalizeEffort,
  saveComposerState,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantComposerState,
  type AssistantEffort,
  type AssistantModelOption,
} from "@/lib/assistantSettings";
import { cn, SCROLLBAR_THIN } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

function eventHasFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

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

export type AssistantComposerSubmitKind = "message" | "infer" | "btw" | "goal";

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

export interface ComposerContextInsertRequest {
  id: number;
  ref: ComposerContextChipRef;
}

interface AssistantComposerProps {
  projectSlug: string;
  bundle: AssistantCatalogBundle;
  disabled?: boolean;
  floating?: boolean;
  hasQueued?: boolean;
  seedMessage?: string | null;
  slashContext?: SlashCommandContext;
  slashCommandExtras?: SlashCommandDef[];
  /** Incrementing token from the parent's Magic button that opens the palette. */
  magicPaletteRequestId?: number;
  placeholder?: string;
  /** When `null`, the footer hint is hidden. */
  hint?: string | null;
  resetToken?: number;
  composerDisabled?: boolean;
  agentMenuDisabled?: boolean;
  canSubmit?: boolean;
  /** Allow submit (and the default send affordance) with an empty input. */
  allowEmptySubmit?: boolean;
  /**
   * Enables `@`-mentions (issues / files / PRs) in the textarea. When on, the
   * parent supplies `mentionOptions` for the current query (reported via
   * `onMentionQueryChange`) and records selections via `onMentionSelect` so it
   * can expand the inserted tokens into the dispatched prompt.
   */
  mentionsEnabled?: boolean;
  mentionOptions?: ResolvedMention[];
  onMentionQueryChange?: (query: string | null) => void;
  onMentionSelect?: (entity: ResolvedMention) => void;
  /**
   * Optional element rendered flush inside the composer card, above the input
   * (e.g. the authoring-goal pill). Sharing the card makes it read as one piece
   * with the message box instead of a detached banner.
   */
  header?: ReactNode;
  toolbarAfterAttach?: ReactNode;
  submitActions?: ReactNode;
  footer?: ReactNode;
  contextInsertRequest?: ComposerContextInsertRequest | null;
  onForceQueued?: () => void;
  /** Called when Enter is pressed with an empty input (no attachments). */
  onEmptySubmit?: () => void;
  onSubmit: (payload: AssistantComposerSubmit) => void;
  onComposerSnapshot?: (snapshot: ComposerSnapshot) => void;
  /** Reports the currently selected agent (on mount and on every change). */
  onAgentChange?: (agent: AgentKind) => void;
  /** Reports the selected agent's model/effort settings (on mount and change). */
  onSettingsChange?: (agent: AgentKind, settings: AssistantComposerSettings) => void;
  /** Initial/server-resolved agent for reopening a persisted session. */
  agentSeed?: AgentKind | null;
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
  slashContext = "authoring",
  slashCommandExtras,
  magicPaletteRequestId = 0,
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
  dropTargetRef,
}: AssistantComposerProps) {
  const { t } = useTranslation();
  const [input, setInput] = useState("");
  const [magicOpen, setMagicOpen] = useState(false);
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [contextRefs, setContextRefs] = useState<ComposerContextChipRef[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [nativeDropZoneActive, setNativeDropZoneActive] = useState(false);
  const dragDepthRef = useRef(0);
  const [composerState, setComposerState] = useState<AssistantComposerState>(() => loadComposerState(bundle));
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

  const effortOptions = effortsForModel(catalog, settings.model);

  useEffect(() => {
    if (!agentSeed) return;
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
  }, [agentSeed, bundle]);

  // Persist on every state change
  useEffect(() => {
    saveComposerState(composerState);
  }, [composerState]);

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

    textarea.scrollTop = textarea.scrollHeight;
  }, [input]);

  useEffect(() => {
    if (resetToken === undefined) return;
    setInput("");
    setAttachments([]);
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

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return;
    if (!projectSlug.trim()) {
      toast.error(t("assistant.composer.attachmentsUnavailable"));
      return;
    }

    for (const file of files) {
      try {
        validateAttachmentFile(file);
        setUploadingImage(true);
        const uploaded = await uploadAssistantAttachment(projectSlug, file);
        const attachment = createAttachmentPreview(file, uploaded);
        setAttachments((current) => [...current, attachment]);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : t("assistant.composer.uploadFailed"));
      } finally {
        setUploadingImage(false);
      }
    }
  }

  const uploadFilesRef = useRef(uploadFiles);
  uploadFilesRef.current = uploadFiles;

  // When a drop target element is provided (e.g. the whole assistant panel),
  // attach native drag-and-drop listeners to it so files can be dropped
  // anywhere inside the panel, not only on the composer form.
  useEffect(() => {
    const el = dropTargetRef?.current ?? null;
    if (!el) {
      setNativeDropZoneActive(false);
      return;
    }

    setNativeDropZoneActive(true);

    const hasFiles = (event: globalThis.DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");

    const onDragEnter = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    };
    const onDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    };
    const onDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      void uploadFilesRef.current(Array.from(event.dataTransfer?.files ?? []));
    };

    el.addEventListener("dragenter", onDragEnter);
    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);

    return () => {
      el.removeEventListener("dragenter", onDragEnter);
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [dropTargetRef]);

  async function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    await uploadFiles(files);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const files = extractFilesFromClipboard(event);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadFiles(files);
  }

  function handleDragEnter(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (!eventHasFiles(event)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    void uploadFiles(files);
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target) revokeAttachmentPreviews([target]);
      return current.filter((attachment) => attachment.id !== id);
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
    setAttachments([]);
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

    if (event.key === "Tab" && !event.shiftKey && showPalette && paletteCommands.length > 0) {
      event.preventDefault();
      applySlashCommand(paletteCommands[0]);
      return;
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
      <ComposerCommandPalette
        open={magicOpen}
        onOpenChange={setMagicOpen}
        commands={magicCommands}
        onSelect={applySlashCommand}
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
              if (attachment.type === "image") {
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
            <div className={cn("max-h-52 overflow-y-auto", SCROLLBAR_THIN)}>
              {paletteCommands.map((command) => (
                <button
                  key={command.name}
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                  onClick={() => applySlashCommand(command)}
                >
                  <span className="shrink-0 font-mono text-xs font-semibold">{command.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{command.description}</span>
                </button>
              ))}
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
          className="min-h-[4.5rem] resize-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
        />

        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-1">
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
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1">
            <AgentMenu
              bundle={bundle}
              agent={composerState.agent}
              disabled={disabled || agentMenuDisabled}
              onChange={updateAgent}
            />
            <ModelMenu
              catalog={catalog}
              model={settings.model}
              disabled={disabled || composerDisabled}
              onChange={updateModel}
            />
            {effortOptions.length > 0 ? (
              <EffortMenu
                catalog={catalog}
                model={settings.model}
                effort={settings.effort}
                options={effortOptions}
                disabled={disabled || composerDisabled}
                onChange={updateEffort}
              />
            ) : (
              <DerivedThinkingMenu
                catalog={catalog}
                model={settings.model}
                disabled={disabled || composerDisabled}
                onModelChange={updateModel}
              />
            )}
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

function AgentMenu({
  bundle,
  agent,
  disabled,
  onChange,
}: {
  bundle: AssistantCatalogBundle;
  agent: AgentKind;
  disabled?: boolean;
  onChange: (agent: AgentKind) => void;
}) {
  const { t } = useTranslation();
  const current = catalogFor(bundle, agent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          <Bot className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          {agentKindLabel(current.agent, t)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.agentMenu")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={agent} onValueChange={(v) => onChange(v as AgentKind)}>
          {bundle.agents.map((catalog) => (
            <DropdownMenuRadioItem key={catalog.agent} value={catalog.agent}>
              {agentKindLabel(catalog.agent, t)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Renders a "thinking intensity" icon (Jean-style) for a reasoning-effort id.
 * Returns an element (not a component type) so it can be used inline during
 * render without tripping react-hooks/static-components.
 */
function effortIconElement(effortId: string, testId: string): ReactNode {
  const id = effortId.toLowerCase();
  const className = "h-3.5 w-3.5 shrink-0";
  if (id === "low" || id === "minimal") return <Feather className={`${className} text-sky-500`} data-testid={testId} />;
  if (id === "high") return <Flame className={`${className} text-orange-500`} data-testid={testId} />;
  if (id === "xhigh" || id === "max" || id === "ultra" || id === "ultracode") {
    return <Sparkles className={`${className} text-fuchsia-500`} data-testid={testId} />;
  }
  return <Brain className={`${className} text-violet-500`} data-testid={testId} />;
}

const DERIVED_VARIANT_TOKENS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "thinking",
  "fast",
]);

const DERIVED_EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

interface DerivedThinkingOption {
  key: string;
  model: string;
  effort: string;
  thinking: boolean;
  label: string;
}

function DerivedThinkingMenu({
  catalog,
  model,
  disabled,
  onModelChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  disabled?: boolean;
  onModelChange: (model: string) => void;
}) {
  const { t } = useTranslation();
  const options = derivedThinkingOptions(catalog, model, t);
  const current = options.find((option) => option.model === model);

  if (!current || options.length <= 1) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortIconElement(current.effort || "medium", "derived-effort-trigger-icon")}
          {current.label}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.reasoningEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current.key} onValueChange={(key) => {
          const option = options.find((entry) => entry.key === key);
          if (option) onModelChange(option.model);
        }}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.key} value={option.key} className="gap-2">
              {effortIconElement(option.effort || "medium", `derived-effort-icon-${option.key}`)}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function derivedThinkingOptions(
  catalog: AssistantAgentCatalog,
  modelId: string,
  t: ReturnType<typeof useTranslation>["t"],
): DerivedThinkingOption[] {
  const currentModel = findCatalogModel(catalog, modelId);
  const current = currentModel ? derivedModelVariant(currentModel) : null;
  const target = current ?? firstDerivedModelVariant(catalog);
  if (!target) return [];

  const seen = new Set<string>();
  const modelOptions = catalog.models
    .map((entry) => ({ entry, variant: derivedModelVariant(entry) }))
    .filter(({ variant }) => variant && variant.baseKey === target.baseKey && variant.fast === target.fast)
    .flatMap(({ entry, variant }) => {
      if (!variant) return [];
      const key = `${variant.thinking ? "thinking" : "standard"}:${variant.effort}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{
        key,
        model: entry.model,
        effort: variant.effort,
        thinking: variant.thinking,
        label: derivedThinkingLabel(catalog, entry.model, variant.effort, variant.thinking, t),
      }];
    })
    .sort((a, b) => derivedOptionSort(a) - derivedOptionSort(b));

  if (currentModel?.model === "auto") {
    return [
      {
        key: "auto",
        model: "auto",
        effort: "",
        thinking: false,
        label: t("assistant.composer.autoThinking"),
      },
      ...modelOptions,
    ];
  }

  return modelOptions;
}

function derivedThinkingLabel(
  catalog: AssistantAgentCatalog,
  modelId: string,
  effort: string,
  thinking: boolean,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  const base = effort ? effortLabel(catalog, modelId, effort, t) : t("assistant.composer.autoThinking");
  return thinking ? t("assistant.composer.thinkingEffort", { effort: base }) : base;
}

function derivedOptionSort(option: DerivedThinkingOption): number {
  const effortIndex = DERIVED_EFFORT_ORDER.indexOf(option.effort as (typeof DERIVED_EFFORT_ORDER)[number]);
  const normalizedEffortIndex = effortIndex === -1 ? DERIVED_EFFORT_ORDER.length : effortIndex;
  return (option.thinking ? 100 : 0) + normalizedEffortIndex;
}

function derivedModelVariant(model: AssistantModelOption):
  | { baseKey: string; effort: string; thinking: boolean; fast: boolean }
  | null {
  const tokens = model.model.toLowerCase().split("-").filter(Boolean);
  if (tokens.length === 0 || model.model === "auto") return null;

  const fast = tokens.includes("fast");
  const thinking = tokens.includes("thinking") || /\bthinking\b/i.test(model.label);
  const effort = explicitEffort(tokens, model.label);
  const baseTokens = tokens.filter((token) => !DERIVED_VARIANT_TOKENS.has(token));

  return {
    baseKey: baseTokens.join("-"),
    effort: effort || "medium",
    thinking,
    fast,
  };
}

function firstDerivedModelVariant(catalog: AssistantAgentCatalog):
  | { baseKey: string; effort: string; thinking: boolean; fast: boolean }
  | null {
  for (const model of catalog.models) {
    const variant = derivedModelVariant(model);
    if (variant) return variant;
  }
  return null;
}

function explicitEffort(tokens: string[], label: string): string | null {
  for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh", "max"]) {
    if (tokens.includes(effort)) return effort;
  }
  const lower = label.toLowerCase();
  if (/\bextra high\b/.test(lower)) return "xhigh";
  if (/\bmax\b/.test(lower)) return "max";
  if (/\bhigh\b/.test(lower)) return "high";
  if (/\bmedium\b/.test(lower)) return "medium";
  if (/\blow\b/.test(lower)) return "low";
  if (/\bnone\b/.test(lower)) return "none";
  return null;
}

function findCatalogModel(catalog: AssistantAgentCatalog, modelId: string): AssistantModelOption | undefined {
  return catalog.models.find((entry) => entry.model === modelId || entry.id === modelId);
}

function EffortMenu({
  catalog,
  model,
  effort,
  options,
  disabled,
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  effort: AssistantEffort;
  options: ReturnType<typeof effortsForModel>;
  disabled?: boolean;
  onChange: (effort: AssistantEffort) => void;
}) {
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortIconElement(effort, "effort-trigger-icon")}
          {effortLabel(catalog, model, effort)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("assistant.composer.reasoningEffort")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={effort} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} className="gap-2">
              {effortIconElement(option.id, `effort-icon-${option.id}`)}
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
