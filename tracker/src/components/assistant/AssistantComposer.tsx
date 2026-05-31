import { AudioLines, ChevronDown, Mic, Plus, Square, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  type AssistantAttachment,
  blobToAudioAttachment,
  createImageAttachmentPreview,
  revokeAttachmentPreviews,
  serializeAttachments,
  validateImageFile,
} from "@/components/assistant/assistantAttachments";
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
import { useAudioRecorder } from "@/hooks/useAudioRecorder";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import {
  effortLabel,
  effortsForModel,
  loadAssistantComposerSettings,
  modelLabel,
  normalizeEffort,
  saveAssistantComposerSettings,
  type AssistantCodexCatalog,
  type AssistantComposerSettings,
  type AssistantEffort,
} from "@/lib/assistantSettings";
import { cn } from "@/lib/utils";

export interface AssistantComposerSubmit {
  message: string;
  settings: AssistantComposerSettings;
  attachments: ReturnType<typeof serializeAttachments>;
}

interface AssistantComposerProps {
  projectSlug: string;
  catalog: AssistantCodexCatalog;
  disabled?: boolean;
  onSubmit: (payload: AssistantComposerSubmit) => void;
}

export function AssistantComposer({ projectSlug, catalog, disabled = false, onSubmit }: AssistantComposerProps) {
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [settings, setSettings] = useState(() => loadAssistantComposerSettings(catalog));
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recordingRef = useRef(false);
  const audio = useAudioRecorder();
  const speech = useSpeechRecognition();
  const {
    error: audioError,
    permission: audioPermission,
    recording,
    start: startAudioRecording,
    stop: stopAudioRecording,
    supported: audioSupported,
  } = audio;
  const {
    error: speechError,
    listening: speechListening,
    start: startSpeechRecognition,
    stop: stopSpeechRecognition,
    supported: speechSupported,
  } = speech;

  const selectedModel =
    catalog.models.find((model) => model.model === settings.model) ?? catalog.models[0];
  const effortOptions = effortsForModel(catalog, settings.model);

  useEffect(() => {
    saveAssistantComposerSettings(settings);
  }, [settings]);

  useEffect(() => {
    setSettings((current) => {
      const modelOption = catalog.models.find((model) => model.model === current.model) ?? catalog.models[0];
      return {
        model: modelOption.model,
        effort: normalizeEffort(modelOption, current.effort),
      };
    });
  }, [catalog]);

  useEffect(() => {
    return () => {
      stopAudioRecording();
      stopSpeechRecognition();
    };
  }, [stopAudioRecording, stopSpeechRecognition]);

  useEffect(() => {
    recordingRef.current = recording;
  }, [recording]);

  const canSend =
    !disabled &&
    !recording &&
    !uploadingImage &&
    (input.trim().length > 0 || attachments.length > 0);

  function updateModel(model: string) {
    const modelOption = catalog.models.find((entry) => entry.model === model) ?? catalog.models[0];
    setSettings({
      model: modelOption.model,
      effort: normalizeEffort(modelOption, settings.effort),
    });
  }

  function updateEffort(effort: AssistantEffort) {
    setSettings((current) => ({ ...current, effort: normalizeEffort(selectedModel, effort) }));
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

    onSubmit({
      message: input,
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
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitCurrent();
  }

  async function toggleRecording() {
    if (disabled) return;

    if (recording) {
      recordingRef.current = false;
      stopAudioRecording();
      stopSpeechRecognition();
      return;
    }

    if (!audioSupported) {
      toast.error("Microphone recording requires HTTPS in a supported browser.");
      return;
    }

    if (audioPermission === "denied") {
      toast.error("Microphone permission denied. Enable it in your browser site settings and reload.");
      return;
    }

    const started = await startAudioRecording(async (blob, durationMs) => {
      try {
        const attachment = await blobToAudioAttachment(blob, durationMs);
        setAttachments((current) => [...current, attachment]);
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : "Failed to save recording.");
      }
    });

    if (!started) {
      toast.error(audioError ?? "Could not start recording.");
      return;
    }

    recordingRef.current = true;

    if (speechSupported) {
      window.setTimeout(() => {
        if (!recordingRef.current) return;

        startSpeechRecognition((text, isFinal) => {
          if (!isFinal) return;
          setInput((current) => (current.trim() ? `${current.trim()} ${text}` : text));
        });
      }, 300);
    }
  }

  return (
    <form className="border-t bg-background p-4" onSubmit={handleSubmit}>
      <div
        className={cn(
          "rounded-2xl border bg-card shadow-sm transition-shadow",
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

        <Textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message..."
          disabled={disabled}
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
            <span className="rounded-md border bg-muted/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {catalog.agentLabel}
            </span>
            <ModelMenu
              catalog={catalog}
              model={settings.model}
              disabled={disabled}
              onChange={updateModel}
            />
            <EffortMenu
              catalog={catalog}
              model={settings.model}
              effort={settings.effort}
              options={effortOptions}
              disabled={disabled}
              onChange={updateEffort}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 rounded-full",
                recording &&
                  "bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 dark:bg-red-950/30 dark:text-red-400 dark:hover:bg-red-950/50",
              )}
              disabled={disabled}
              aria-label={recording ? "Stop recording" : "Record audio"}
              onClick={() => void toggleRecording()}
            >
              {recording ? (
                <Square className="h-3.5 w-3.5 fill-current" />
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

      <p className="mt-2 text-xs text-muted-foreground">
        Enter to send · Shift+Enter for a new line · Models from {catalog.command}
        {audioPermission === "denied" ? (
          <span className="text-destructive"> · Microphone blocked — enable it in browser settings</span>
        ) : null}
        {audioError ? <span className="text-destructive"> · {audioError}</span> : null}
        {speechError && recording ? (
          <span className="text-muted-foreground"> · Live captions unavailable ({speechError})</span>
        ) : null}
      </p>
    </form>
  );
}

function ModelMenu({
  catalog,
  model,
  disabled,
  onChange,
}: {
  catalog: AssistantCodexCatalog;
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
  catalog: AssistantCodexCatalog;
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
