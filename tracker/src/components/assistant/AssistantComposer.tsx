import { AudioLines, ChevronDown, Mic, Plus, Square, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type AssistantAttachment,
  createImageAttachmentPreview,
  revokeAttachmentPreviews,
  serializeAttachments,
  validateImageFile,
} from "@/components/assistant/assistantAttachments";
import { matchingSlashCommands, parseSlashCommand } from "@/components/assistant/slashCommands";
import { uploadAssistantAttachment } from "@/services/assistant";
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
  modelLabel,
  normalizeEffort,
  saveComposerState,
  type AssistantAgentCatalog,
  type AssistantCatalogBundle,
  type AssistantComposerSettings,
  type AssistantComposerState,
  type AssistantEffort,
} from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";
import type { AgentKind } from "@/types/issue";

export type AssistantComposerSubmitKind = "message" | "infer" | "btw";

export interface AssistantComposerSubmit {
  kind: AssistantComposerSubmitKind;
  message: string;
  agent: AgentKind;
  settings: AssistantComposerSettings;
  attachments: ReturnType<typeof serializeAttachments>;
}

interface AssistantComposerProps {
  projectSlug: string;
  bundle: AssistantCatalogBundle;
  disabled?: boolean;
  floating?: boolean;
  hasQueued?: boolean;
  seedMessage?: string | null;
  onForceQueued?: () => void;
  onSubmit: (payload: AssistantComposerSubmit) => void;
  /** Reports the currently selected agent (on mount and on every change). */
  onAgentChange?: (agent: AgentKind) => void;
}

export function AssistantComposer({
  projectSlug,
  bundle,
  disabled = false,
  floating = false,
  hasQueued = false,
  seedMessage = null,
  onForceQueued,
  onSubmit,
  onAgentChange,
}: AssistantComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [composerState, setComposerState] = useState<AssistantComposerState>(() => loadComposerState(bundle));
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  // Persist on every state change
  useEffect(() => {
    saveComposerState(composerState);
  }, [composerState]);

  // Surface the selected agent so consumers (e.g. the dispatch panel) can mirror it.
  useEffect(() => {
    onAgentChange?.(composerState.agent);
  }, [composerState.agent, onAgentChange]);

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

  const canSend = !recording && !uploadingImage && (input.trim().length > 0 || attachments.length > 0);

  const paletteCommands = matchingSlashCommands(input);
  const showPalette = paletteCommands.length > 0 && input.trim().split(" ").length === 1;

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

  async function handleImagePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    for (const file of files) {
      try {
        validateImageFile(file);
        setUploadingImage(true);
        const uploaded = await uploadAssistantAttachment(projectSlug, file);
        const attachment = createImageAttachmentPreview(file, uploaded);
        setAttachments((current) => [...current, attachment]);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Failed to upload image.");
      } finally {
        setUploadingImage(false);
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((attachment) => attachment.id === id);
      if (target) revokeAttachmentPreviews([target]);
      return current.filter((attachment) => attachment.id !== id);
    });
  }

  function submitCurrent() {
    if (!canSend) return;

    const parsed = parseSlashCommand(input);
    if (parsed.kind !== "message" && parsed.argument.length === 0) return;

    onSubmit({
      kind: parsed.kind,
      message: parsed.kind === "message" ? input : parsed.argument,
      agent: composerState.agent,
      settings,
      attachments: serializeAttachments(attachments),
    });

    revokeAttachmentPreviews(attachments);
    setInput("");
    setAttachments([]);
    recordingRef.current = false;
    stopSpeechRecognition();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitCurrent();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Tab" && !event.shiftKey && showPalette && paletteCommands.length > 0) {
      event.preventDefault();
      setInput(`${paletteCommands[0].name} `);
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();

    if (input.trim().length === 0) {
      if (hasQueued) onForceQueued?.();
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
      toast.error("Voice dictation is not supported in this browser.");
      return;
    }

    recordingRef.current = true;

    startSpeechRecognition((text, isFinal) => {
      if (!isFinal) return;
      setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
    });
  }

  return (
    <form className={cn("bg-background", floating ? "px-0 pb-0 pt-0" : "border-t p-4")} onSubmit={handleSubmit}>
      <div
        className={cn(
          "rounded-2xl border bg-card transition-shadow",
          floating ? "shadow-lg" : "shadow-sm",
          recording && "ring-2 ring-primary/30",
        )}
      >
        {attachments.length > 0 ? (
          <div className="flex flex-wrap gap-2 border-b px-3 py-2">
            {attachments.map((attachment) =>
              attachment.type === "image" ? (
                <div key={attachment.id} className="group relative">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.name}
                    className="h-16 w-16 rounded-lg border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute -right-1 -top-1 rounded-full border bg-background p-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ) : (
                <div
                  key={attachment.id}
                  className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1.5 text-xs"
                >
                  <AudioLines className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="max-w-[10rem] truncate">{attachment.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${attachment.name}`}
                    onClick={() => removeAttachment(attachment.id)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ),
            )}
          </div>
        ) : null}

        {showPalette ? (
          <div className="border-b px-2 py-1.5">
            {paletteCommands.map((command) => (
              <button
                key={command.name}
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted/60"
                onClick={() => setInput(`${command.name} `)}
              >
                <span className="font-mono text-xs font-semibold">{command.name}</span>
                <span className="truncate text-xs text-muted-foreground">{command.description}</span>
              </button>
            ))}
            <p className="px-2 pt-1 text-[10px] text-muted-foreground">Tab to complete</p>
          </div>
        ) : null}

        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          className="min-h-[4.5rem] resize-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0"
        />

        <div className="flex items-center justify-between gap-2 px-3 pb-3">
          <div className="flex items-center gap-1">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => void handleImagePick(event)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              disabled={disabled || uploadingImage}
              aria-label="Attach image"
              onClick={() => fileInputRef.current?.click()}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1">
            <AgentMenu
              bundle={bundle}
              agent={composerState.agent}
              disabled={disabled}
              onChange={updateAgent}
            />
            <ModelMenu
              catalog={catalog}
              model={settings.model}
              disabled={disabled}
              onChange={updateModel}
            />
            {effortOptions.length > 0 ? (
              <EffortMenu
                catalog={catalog}
                model={settings.model}
                effort={settings.effort}
                options={effortOptions}
                disabled={disabled}
                onChange={updateEffort}
              />
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "relative h-8 w-8 overflow-visible rounded-full",
                recording &&
                  "bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50",
              )}
              disabled={disabled}
              aria-label={recording ? "Stop recording" : "Record audio"}
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
                Recording
              </span>
            ) : null}
          </div>
        </div>
      </div>

      <p className={cn("text-xs text-muted-foreground", floating ? "mt-1.5" : "mt-2")}>
        Enter to send · Shift+Enter for a new line · Models from {catalog.command}
        {speechError ? <span className="text-destructive"> · Voice dictation unavailable ({speechError})</span> : null}
      </p>
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
  const current = catalogFor(bundle, agent);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {current.agentLabel}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Agent</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={agent} onValueChange={(v) => onChange(v as AgentKind)}>
          {bundle.agents.map((catalog) => (
            <DropdownMenuRadioItem key={catalog.agent} value={catalog.agent}>
              {catalog.agentLabel}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelMenu({
  catalog,
  model,
  disabled,
  onChange,
}: {
  catalog: AssistantAgentCatalog;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {modelLabel(catalog, model)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{catalog.agentLabel} · Model</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={model} onValueChange={onChange}>
          {catalog.models.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.model}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" disabled={disabled}>
          {effortLabel(catalog, model, effort)}
          <ChevronDown className="h-3 w-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={effort} onValueChange={onChange}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
