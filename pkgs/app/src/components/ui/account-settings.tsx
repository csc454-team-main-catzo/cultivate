import * as React from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { AvatarUploader } from "@/components/ui/avatar-uploader";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DEFAULT_AVATAR =
  "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=160&h=160&fit=crop";

interface AccountSettingsProps {
  name: string;
  email: string;
  avatar?: string | null;
  postalCode?: string | null;
  onNameSave?: (name: string) => Promise<void>;
  onEmailSave?: (email: string) => Promise<void>;
  onAvatarSave?: (avatarDataUrl: string) => Promise<void>;
  onPostalSave?: (postalCode: string) => Promise<void>;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || "??";
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function AccountSettings({
  name,
  email,
  avatar: initialAvatar,
  postalCode: initialPostal,
  onNameSave,
  onEmailSave,
  onAvatarSave,
  onPostalSave,
}: AccountSettingsProps) {
  const [photo, setPhoto] = React.useState<string>(
    initialAvatar ?? DEFAULT_AVATAR
  );
  const [nameValue, setNameValue] = React.useState(name);
  const [emailValue, setEmailValue] = React.useState(email);
  const [postalValue, setPostalValue] = React.useState(initialPostal ?? "");
  const [nameSaving, setNameSaving] = React.useState(false);
  const [emailSaving, setEmailSaving] = React.useState(false);
  const [postalSaving, setPostalSaving] = React.useState(false);

  React.useEffect(() => {
    setNameValue(name);
    setEmailValue(email);
  }, [name, email]);

  React.useEffect(() => {
    setPostalValue(initialPostal ?? "");
  }, [initialPostal]);

  React.useEffect(() => {
    if (initialAvatar) setPhoto(initialAvatar);
  }, [initialAvatar]);

  const handleUpload = async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    setPhoto(dataUrl);
    if (onAvatarSave) {
      await onAvatarSave(dataUrl);
    }
    return { success: true };
  };

  const handleNameSave = async () => {
    if (!onNameSave || nameValue === name) return;
    setNameSaving(true);
    try {
      await onNameSave(nameValue);
    } finally {
      setNameSaving(false);
    }
  };

  const handleEmailSave = async () => {
    if (!onEmailSave || emailValue === email) return;
    setEmailSaving(true);
    try {
      await onEmailSave(emailValue);
    } finally {
      setEmailSaving(false);
    }
  };

  const handlePostalSave = async () => {
    if (!onPostalSave || postalValue.trim() === (initialPostal ?? "").trim()) return;
    setPostalSaving(true);
    try {
      await onPostalSave(postalValue.trim());
    } finally {
      setPostalSaving(false);
    }
  };

  return (
    <section className="relative min-h-screen w-full px-4 py-10">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 isolate opacity-80 [contain:strict]"
      >
        <div className="absolute -top-24 left-0 h-80 w-[140%] -translate-y-1/2 -rotate-45 rounded-full bg-[radial-gradient(68.54%_68.72%_at_55.02%_31.46%,rgba(0,0,0,0.04)_0,rgba(0,0,0,0.02)_50%,rgba(0,0,0,0.01)_80%)]" />
        <div className="absolute -top-24 left-0 h-80 w-[60%] -translate-y-1/2 -rotate-45 rounded-full bg-[radial-gradient(50%_50%_at_50%_50%,rgba(0,0,0,0.03)_0,rgba(0,0,0,0.01)_80%,transparent_100%)]" />
      </div>

      <div className="mx-auto w-full max-w-4xl space-y-8">
        <div className="flex flex-col">
          <h2 className="text-2xl font-bold text-zinc-900">Account Settings</h2>
          <p className="text-base text-zinc-500">
            Manage account and your personal information.
          </p>
        </div>
        <Separator />

        <div className="py-2">
          <SectionColumns
            title="Your Avatar"
            description="An avatar is optional but strongly recommended."
          >
            <AvatarUploader onUpload={handleUpload}>
              <Avatar className="relative mx-auto h-20 w-20 cursor-pointer hover:opacity-80 transition-opacity">
                <AvatarImage src={photo} alt={name} />
                <AvatarFallback className="border border-zinc-200 text-2xl font-bold text-zinc-600">
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
            </AvatarUploader>
          </SectionColumns>
          <Separator />

          <SectionColumns
            title="Your Name"
            description="Please enter a display name you are comfortable with."
          >
            <div className="w-full space-y-1">
              <Label htmlFor="name" className="sr-only">
                Name
              </Label>
              <div className="flex w-full items-center justify-center gap-2">
                <Input
                  id="name"
                  placeholder="Enter Your Name"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  maxLength={32}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleNameSave}
                  disabled={nameSaving || nameValue === name}
                >
                  {nameSaving ? "Saving..." : "Save"}
                </Button>
              </div>
              <p className="text-xs text-zinc-500">Max 32 characters</p>
            </div>
          </SectionColumns>
          <Separator />

          {onPostalSave && (
            <>
              <SectionColumns
                title="Postal code"
                description="Canadian postal code (e.g. K1A 0B1). Used for listing location."
              >
                <div className="w-full space-y-1">
                  <Label htmlFor="postal" className="sr-only">
                    Postal code
                  </Label>
                  <div className="flex w-full items-center justify-center gap-2">
                    <Input
                      id="postal"
                      placeholder="K1A 0B1"
                      value={postalValue}
                      onChange={(e) => setPostalValue(e.target.value)}
                      maxLength={10}
                      autoComplete="postal-code"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handlePostalSave}
                      disabled={
                        postalSaving ||
                        postalValue.trim() === (initialPostal ?? "").trim()
                      }
                    >
                      {postalSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              </SectionColumns>
              <Separator />
            </>
          )}

          <SectionColumns
            title="Your Email"
            description="Please enter a Primary Email Address."
          >
            <div className="w-full space-y-1">
              <Label htmlFor="email" className="sr-only">
                Email
              </Label>
              <div className="flex w-full items-center justify-center gap-2">
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter Your Email"
                  value={emailValue}
                  onChange={(e) => setEmailValue(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleEmailSave}
                  disabled={emailSaving || emailValue === email}
                >
                  {emailSaving ? "Saving..." : "Save"}
                </Button>
              </div>
            </div>
          </SectionColumns>
        </div>
      </div>
    </section>
  );
}

interface SectionColumnsProps {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}

function SectionColumns({
  title,
  description,
  children,
  className,
}: SectionColumnsProps) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-x-10 gap-y-4 py-8 md:grid-cols-10",
        "animate-in fade-in duration-500"
      )}
    >
      <div className="w-full space-y-1.5 md:col-span-4">
        <h2 className="text-lg font-semibold leading-none text-zinc-900">
          {title}
        </h2>
        {description && (
          <p className="text-sm text-zinc-500 text-balance">{description}</p>
        )}
      </div>
      <div className={cn("md:col-span-6", className)}>{children}</div>
    </div>
  );
}
