import React, {
  useRef,
  useEffect,
  useState,
  useCallback,
  memo,
  type Dispatch,
  type SetStateAction,
  type ChangeEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2 as LoaderIcon, X as XIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Type Definitions
export interface Attachment {
  url: string;
  name: string;
  contentType: string;
  size: number;
}

export interface SuggestedAction {
  title: string;
  label: string;
  action: string;
}

// Button variants
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-zinc-900 text-white hover:bg-zinc-800",
        destructive: "border border-zinc-600 text-zinc-900 hover:bg-zinc-100",
        outline: "border border-zinc-300 bg-white hover:bg-zinc-100 text-zinc-900",
        secondary: "bg-zinc-200 text-zinc-900 hover:bg-zinc-300",
        ghost: "text-zinc-900 hover:bg-zinc-100",
        link: "text-zinc-900 underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
);
Button.displayName = "Button";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "flex min-h-[80px] w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none",
      className
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";

const StopIcon = ({ size = 16 }: { size?: number }) => (
  <svg height={size} viewBox="0 0 16 16" width={size} className="text-current">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M3 3H13V13H3V3Z"
      fill="currentColor"
    />
  </svg>
);

const PaperclipIcon = ({ size = 16 }: { size?: number }) => (
  <svg height={size} viewBox="0 0 16 16" width={size} className="text-current -rotate-45">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M10.8591 1.70735C10.3257 1.70735 9.81417 1.91925 9.437 2.29643L3.19455 8.53886C2.56246 9.17095 2.20735 10.0282 2.20735 10.9222C2.20735 11.8161 2.56246 12.6734 3.19455 13.3055C3.82665 13.9376 4.68395 14.2927 5.57786 14.2927C6.47178 14.2927 7.32908 13.9376 7.96117 13.3055L14.2036 7.06304L14.7038 6.56287L15.7041 7.56321L15.204 8.06337L8.96151 14.3058C8.06411 15.2032 6.84698 15.7074 5.57786 15.7074C4.30875 15.7074 3.09162 15.2032 2.19422 14.3058C1.29682 13.4084 0.792664 12.1913 0.792664 10.9222C0.792664 9.65305 1.29682 8.43592 2.19422 7.53852L8.43666 1.29609C9.07914 0.653606 9.95054 0.292664 10.8591 0.292664C11.7678 0.292664 12.6392 0.653606 13.2816 1.29609C13.9241 1.93857 14.2851 2.80997 14.2851 3.71857C14.2851 4.62718 13.9241 5.49858 13.2816 6.14106L13.2814 6.14133L7.0324 12.3835C6.64459 12.7712 6.11905 12.9888 5.57107 12.9888C5.02297 12.9888 4.49731 12.7711 4.10974 12.3835C3.72217 11.9959 3.50444 11.4703 3.50444 10.9222C3.50444 10.3741 3.72217 9.8484 4.10974 9.46084L4.11004 9.46054L9.877 3.70039L10.3775 3.20051L11.3772 4.20144L10.8767 4.70131L5.11008 10.4612C4.98779 10.5835 4.91913 10.7493 4.91913 10.9222C4.91913 11.0951 4.98782 11.2609 5.11008 11.3832C5.23234 11.5054 5.39817 11.5741 5.57107 11.5741C5.74398 11.5741 5.9098 11.5054 6.03206 11.3832L6.03233 11.3829L12.2813 5.14072C12.6586 4.7633 12.8704 4.25185 12.8704 3.71857C12.8704 3.18516 12.6585 2.6736 12.2813 2.29643C11.9041 1.91925 11.3926 1.70735 10.8591 1.70735Z"
      fill="currentColor"
    />
  </svg>
);

const ArrowUpIcon = ({ size = 16 }: { size?: number }) => (
  <svg height={size} viewBox="0 0 16 16" width={size} className="text-current">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M8.70711 1.39644C8.31659 1.00592 7.68342 1.00592 7.2929 1.39644L2.21968 6.46966L1.68935 6.99999L2.75001 8.06065L3.28034 7.53032L7.25001 3.56065V14.25V15H8.75001V14.25V3.56065L12.7197 7.53032L13.25 8.06065L14.3107 6.99999L13.7803 6.46966L8.70711 1.39644Z"
      fill="currentColor"
    />
  </svg>
);

// Suggested Actions
const SuggestedActions = memo(function SuggestedActions({
  suggestedActions,
  onSelectAction,
}: {
  suggestedActions: SuggestedAction[];
  onSelectAction: (action: string) => void;
}) {
  return (
    <div className="grid pb-2 sm:grid-cols-2 gap-2 w-full">
      <AnimatePresence>
        {suggestedActions.map((sa, index) => (
          <motion.div
            key={sa.action}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ delay: 0.05 * index }}
            className={index > 1 ? "hidden sm:block" : "block"}
          >
            <Button
              variant="ghost"
              onClick={() => onSelectAction(sa.action)}
              className="text-left border rounded-xl px-4 py-3.5 text-sm flex-1 sm:flex-col w-full h-auto justify-start items-start border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-900 hover:text-zinc-950"
            >
              <span className="font-medium">{sa.title}</span>
              <span className="text-zinc-500">{sa.label}</span>
            </Button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

// Attachment preview
const PreviewAttachment = ({
  attachment,
  isUploading = false,
}: {
  attachment: Attachment;
  isUploading?: boolean;
}) => (
  <div className="flex flex-col gap-1">
    <div className="w-20 h-16 aspect-video bg-zinc-100 rounded-md relative flex flex-col items-center justify-center overflow-hidden border border-zinc-200">
      {attachment.contentType?.startsWith("image/") && attachment.url ? (
        <img
          src={attachment.url}
          alt={attachment.name ?? "Attachment"}
          className="rounded-md size-full object-cover"
        />
      ) : (
        <div className="flex items-center justify-center text-xs text-zinc-500 text-center p-1">
          {attachment.name?.split(".").pop()?.toUpperCase() || "File"}
        </div>
      )}
      {isUploading && (
        <div className="animate-spin absolute text-zinc-500">
          <LoaderIcon className="size-5" />
        </div>
      )}
    </div>
    <div className="text-xs text-zinc-500 max-w-20 truncate">{attachment.name}</div>
  </div>
);

// Role-based suggested actions for Glean
export const FARMER_SUGGESTED_ACTIONS: SuggestedAction[] = [
  { title: "Create a listing", label: "for my harvest", action: "Create a listing for my harvest" },
  { title: "Ask about price", label: "for organic tomatoes", action: "What's a fair price for organic tomatoes?" },
  { title: "List my harvest", label: "I just harvested 50kg carrots", action: "Just harvested 50kg of ugly carrots, help me list them" },
  { title: "Get pricing advice", label: "for seasonal produce", action: "What price should I set for seasonal produce?" },
];

export const RESTAURANT_SUGGESTED_ACTIONS: SuggestedAction[] = [
  { title: "I need ingredients", label: "20kg carrots by Friday", action: "I need 20kg carrots by Friday" },
  { title: "Find at this price", label: "organic lettuce under $3/kg", action: "Looking for 10kg organic lettuce under $3/kg" },
  { title: "Find produce", label: "fresh tomatoes for delivery", action: "Find farmers with fresh tomatoes for delivery this week" },
  { title: "Place an order", label: "15kg onions, 20kg potatoes", action: "I need 15kg onions and 20kg potatoes — find matches and place order" },
];

// Main Component
export interface MultimodalInputProps {
  suggestedActions: SuggestedAction[];
  attachments: Attachment[];
  setAttachments: Dispatch<SetStateAction<Attachment[]>>;
  onSendMessage: (params: { input: string; attachments: Attachment[] }) => void;
  onStopGenerating: () => void;
  isGenerating: boolean;
  canSend: boolean;
  placeholder?: string;
  className?: string;
}

export function MultimodalInput({
  suggestedActions,
  attachments,
  setAttachments,
  onSendMessage,
  onStopGenerating,
  isGenerating,
  canSend,
  placeholder = "Ask Glean...",
  className,
}: MultimodalInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState("");
  const [uploadQueue, setUploadQueue] = useState<string[]>([]);

  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${ta.scrollHeight + 2}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [input, adjustHeight]);

  const resetHeight = useCallback(() => {
    const ta = textareaRef.current;
    if (ta) {
      ta.style.height = "auto";
      ta.rows = 1;
      adjustHeight();
    }
  }, [adjustHeight]);

  const uploadFile = useCallback(async (file: File): Promise<Attachment | undefined> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          const url = URL.createObjectURL(file);
          resolve({
            url,
            name: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          });
        } catch {
          resolve(undefined);
        } finally {
          setUploadQueue((q) => q.filter((n) => n !== file.name));
        }
      }, 500);
    });
  }, []);

  const handleFileChange = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;
      setUploadQueue((q) => [...q, ...files.map((f) => f.name)]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      const MAX = 25 * 1024 * 1024;
      const valid = files.filter((f) => f.size <= MAX);
      const uploaded = await Promise.all(valid.map((f) => uploadFile(f)));
      const ok = uploaded.filter((a): a is Attachment => a !== undefined);
      setAttachments((prev) => [...prev, ...ok]);
    },
    [uploadFile, setAttachments]
  );

  const handleRemoveAttachment = useCallback(
    (a: Attachment) => {
      if (a.url.startsWith("blob:")) URL.revokeObjectURL(a.url);
      setAttachments((prev) => prev.filter((x) => x.url !== a.url || x.name !== a.name));
      textareaRef.current?.focus();
    },
    [setAttachments]
  );

  const submitForm = useCallback(() => {
    if (!input.trim() && attachments.length === 0) return;
    onSendMessage({ input: input.trim(), attachments });
    setInput("");
    setAttachments([]);
    attachments.forEach((a) => {
      if (a.url.startsWith("blob:")) URL.revokeObjectURL(a.url);
    });
    resetHeight();
    textareaRef.current?.focus();
  }, [input, attachments, onSendMessage, setAttachments, resetHeight]);

  const showSuggestedActions =
    input.length === 0 && attachments.length === 0 && uploadQueue.length === 0;
  const isAttachmentDisabled = isGenerating || uploadQueue.length > 0;

  return (
    <div className={cn("relative w-full flex flex-col gap-4", className)}>
      <AnimatePresence>
        {showSuggestedActions && (
          <motion.div
            key="suggested-actions"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.2 }}
          >
            <SuggestedActions
              suggestedActions={suggestedActions}
              onSelectAction={(action) => {
                setInput(action);
                requestAnimationFrame(() => {
                  adjustHeight();
                  textareaRef.current?.focus();
                });
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <input
        type="file"
        className="fixed -top-4 -left-4 size-0.5 opacity-0 pointer-events-none"
        ref={fileInputRef}
        multiple
        onChange={handleFileChange}
        tabIndex={-1}
        disabled={isAttachmentDisabled}
        accept="image/*,video/*,audio/*,.pdf"
      />

      {(attachments.length > 0 || uploadQueue.length > 0) && (
        <div className="flex pt-2 flex-row gap-3 overflow-x-auto items-end pb-2 pl-1">
          {attachments.map((a) => (
            <div key={a.url + a.name} className="relative group">
              <PreviewAttachment attachment={a} />
              <Button
                variant="destructive"
                size="icon"
                className="absolute -top-2 -right-2 h-5 w-5 rounded-full p-0 z-20 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleRemoveAttachment(a)}
                aria-label={`Remove ${a.name}`}
              >
                <XIcon className="size-3" />
              </Button>
            </div>
          ))}
          {uploadQueue.map((name, i) => (
            <PreviewAttachment
              key={`upload-${name}-${i}`}
              attachment={{ url: "", name, contentType: "", size: 0 }}
              isUploading
            />
          ))}
        </div>
      )}

      <div className="relative rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
        <Textarea
          ref={textareaRef}
          placeholder={placeholder}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className={cn(
            "min-h-[44px] max-h-[75dvh] overflow-y-auto rounded-xl border-0 bg-transparent pb-10 text-base text-zinc-900 placeholder:text-zinc-400 focus-visible:ring-0",
            "border-zinc-100"
          )}
          rows={1}
          disabled={!canSend || isGenerating || uploadQueue.length > 0}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !(e.nativeEvent as KeyboardEvent).isComposing
            ) {
              e.preventDefault();
              if (
                canSend &&
                !isGenerating &&
                uploadQueue.length === 0 &&
                (input.trim() || attachments.length > 0)
              ) {
                submitForm();
              }
            }
          }}
        />

        <div className="absolute bottom-0 left-0 p-2 flex flex-row justify-start z-10">
          <Button
            variant="ghost"
            className="rounded-md rounded-bl-lg p-1.5 h-fit border border-zinc-200 hover:bg-zinc-100"
            onClick={() => fileInputRef.current?.click()}
            disabled={isAttachmentDisabled}
            aria-label="Attach files"
          >
            <PaperclipIcon size={14} />
          </Button>
        </div>

        <div className="absolute bottom-0 right-0 p-2 flex flex-row justify-end z-10">
          {isGenerating ? (
            <Button
              className="rounded-full p-1.5 h-fit border border-zinc-900 bg-zinc-900 text-white"
              onClick={(e) => {
                e.preventDefault();
                onStopGenerating();
              }}
              aria-label="Stop"
            >
              <StopIcon size={14} />
            </Button>
          ) : (
            <Button
              className="rounded-full p-1.5 h-fit bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50"
              onClick={(e) => {
                e.preventDefault();
                if (
                  canSend &&
                  !isGenerating &&
                  uploadQueue.length === 0 &&
                  (input.trim() || attachments.length > 0)
                ) {
                  submitForm();
                }
              }}
              disabled={
                !canSend ||
                isGenerating ||
                uploadQueue.length > 0 ||
                (!input.trim() && attachments.length === 0)
              }
              aria-label="Send"
            >
              <ArrowUpIcon size={14} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
